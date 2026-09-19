function createIndexer({ store, source, pagesPerChannel = 3, logger = console }) {
  let running;
  let stopped = false;
  let last = { running: false, errors: 0, lastFinishedAt: null, discovered: 0 };
  const compare = (a, b) => BigInt(a.id) > BigInt(b.id) ? -1 : 1;
  function savePage(page) {
    for (const message of page) {
      if (message.content?.trim()) store.upsert(message);
      else store.deleteMessage(message.id);
    }
  }

  async function syncChannel(channel) {
    let state = store.getState(channel.id);
    if (!state) {
      const page = (await source.fetchPage(channel)).sort(compare);
      savePage(page);
      state = { newest: page[0]?.id ?? '0', oldest: page.at(-1)?.id ?? null, complete: page.length < 100, delta: null };
      store.setState(channel.id, state);
    } else {
      // Persist both ends of a catch-up pass. A large offline backlog must not
      // advance newest until every intervening page has been indexed.
      for (let i = 0; i < pagesPerChannel && !stopped; i++) {
        const page = (await source.fetchPage(channel, state.delta?.before)).sort(compare);
        const fresh = page.filter(message => BigInt(message.id) > BigInt(state.newest));
        savePage(fresh);
        const head = state.delta?.head ?? page[0]?.id ?? state.newest;
        const finished = page.length < 100 || fresh.length < page.length;
        if (finished) {
          state.newest = BigInt(head) > BigInt(state.newest) ? head : state.newest;
          state.delta = null;
        } else {
          state.delta = { head, before: page.at(-1).id };
        }
        store.setState(channel.id, state);
        if (finished) break;
      }
    }
    for (let i = 0; i < pagesPerChannel && !state.complete && !stopped; i++) {
      const page = (await source.fetchPage(channel, state.oldest)).sort(compare);
      savePage(page);
      if (page.length) state.oldest = page.at(-1).id;
      state.complete = page.length < 100;
      store.setState(channel.id, state);
    }
  }

  return {
    sync() {
      if (stopped) return Promise.resolve();
      if (running) return running;
      last = { ...last, running: true, errors: 0 };
      running = (async () => {
        try {
          const channels = await source.discover();
          last.discovered = channels.length;
          last.errors += source.discoveryErrors ?? 0;
          for (const channel of channels) {
            if (stopped) break;
            try { await syncChannel(channel); } catch (error) {
              last.errors++;
              logger.warn(`Index skipped channel ${channel.id}; code=${error.code ?? error.name ?? 'unknown'}`);
            }
          }
        } catch (error) {
          last.errors++;
          logger.warn(`Index discovery failed; code=${error.code ?? error.name ?? 'unknown'}`);
        } finally {
          last.running = false;
          last.lastFinishedAt = new Date().toISOString();
          running = undefined;
        }
      })();
      return running;
    },
    status() { return { ...last, ...store.stats() }; },
    async stop() { stopped = true; await running; },
  };
}

module.exports = { createIndexer };
