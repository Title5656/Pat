const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PermissionFlagsBits: P, PermissionsBitField, ChannelType } = require('discord.js');
const { createDiscordSource } = require('../../src/research/discord-source');

function fixture() {
  const guild = { id: '10', name: 'Friends', members: { me: { id: 'bot' } } };
  const channel = { id: '20', name: 'general', guild, type: ChannelType.GuildText,
    permissionsFor: () => new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory]),
    isThread: () => false,
  };
  const message = { id: '100', channelId: '20', guildId: '10', guild, channel,
    author: { id: '30', username: 'alice' }, member: { displayName: 'Alice' },
    content: 'updated evidence', createdTimestamp: 1700000000000,
  };
  channel.messages = { fetch: async options => {
    assert.equal(options.force, true);
    assert.equal(options.cache, false);
    return message;
  } };
  const client = { user: { id: 'bot' }, guilds: { cache: new Map([['10', guild]]) }, channels: { fetch: async () => channel } };
  return { client, channel, message, guild };
}

test('refresh uses the current Discord message instead of cached indexed text', async () => {
  const { client } = fixture();
  const source = createDiscordSource({ client, qaChannelId: '99' });
  assert.equal((await source.refresh({ id: '100', channelId: '20', guildId: '10' })).content, 'updated evidence');
});

test('revoked channel access, departed servers, missing messages, and Q&A sources are excluded', async () => {
  const { client, channel } = fixture();
  const source = createDiscordSource({ client, qaChannelId: '99' });
  const record = { id: '100', channelId: '20', guildId: '10' };
  channel.permissionsFor = () => new PermissionsBitField([]);
  assert.equal(await source.refresh(record), null);
  channel.permissionsFor = () => new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory]);
  channel.messages.fetch = async () => { throw Object.assign(new Error('missing'), { code: 10008 }); };
  assert.equal(await source.refresh(record), null);
  assert.equal(await source.refresh({ ...record, channelId: '99' }), null);
  client.guilds.cache.clear();
  assert.equal(await source.refresh(record), null);
});

test('transient Discord errors do not masquerade as deleted sources', async () => {
  const { client, channel } = fixture();
  channel.messages.fetch = async () => { throw Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }); };
  const source = createDiscordSource({ client, qaChannelId: '99' });
  await assert.rejects(source.refresh({ id: '100', channelId: '20', guildId: '10' }), /timeout/);
});

test('discovery includes paginated archived threads and isolates failures by guild', async () => {
  const { client, channel, guild } = fixture();
  const thread = { ...channel, id: '21', type: ChannelType.PublicThread, isThread: () => true, archiveTimestamp: 1700000000000 };
  const older = { ...thread, id: '22', archiveTimestamp: 1600000000000 };
  channel.threads = { fetchArchived: async options => {
    if (options.type === 'private') return { threads: new Map(), hasMore: false };
    return options.before
      ? { threads: new Map([['22', older]]), hasMore: false }
      : { threads: new Map([['21', thread]]), hasMore: true };
  } };
  guild.channels = { fetch: async () => new Map([['20', channel]]), fetchActiveThreads: async () => ({ threads: new Map() }) };
  client.guilds.cache.set('bad', { id: 'bad', channels: { fetch: async () => { throw new Error('unavailable'); } } });
  const source = createDiscordSource({ client, qaChannelId: '99', logger: { warn() {} } });
  assert.deepEqual((await source.discover()).map(c => c.id).sort(), ['20', '21', '22']);
  assert.equal(source.discoveryErrors, 1);
});

test('read-only catalog lists readable text channels without exposing the Q&A room', async () => {
  const { client, channel, guild } = fixture();
  const hidden = { ...channel, id: '30', name: 'hidden', permissionsFor: () => new PermissionsBitField([]) };
  const voice = { ...channel, id: '40', name: 'voice', type: ChannelType.GuildVoice };
  const qa = { ...channel, id: '99', name: 'research' };
  guild.channels = { fetch: async () => new Map([
    ['20', channel], ['30', hidden], ['40', voice], ['99', qa],
  ]) };
  const source = createDiscordSource({ client, qaChannelId: '99' });

  assert.deepEqual(await source.listGuilds(), [{ id: '10', name: 'Friends' }]);
  assert.deepEqual(await source.listChannels('10'), [{
    id: '20', guildId: '10', guildName: 'Friends', name: 'general', type: ChannelType.GuildText,
  }]);
  assert.equal(source.deleteMessage, undefined);
  assert.equal(source.deleteChannel, undefined);
});

test('read-only catalog refreshes guilds from Discord when the gateway cache is stale', async () => {
  const { client, channel, guild } = fixture();
  client.guilds.cache.clear();
  const requests = [];
  client.guilds.fetch = async id => {
    requests.push(id ?? 'all');
    return id ? guild : new Map([['10', { id: '10', name: 'Friends' }]]);
  };
  guild.channels = { fetch: async () => new Map([['20', channel]]) };
  const source = createDiscordSource({ client, qaChannelId: '99' });

  assert.deepEqual(await source.listGuilds(), [{ id: '10', name: 'Friends' }]);
  assert.deepEqual(await source.listChannels('10'), [{
    id: '20', guildId: '10', guildName: 'Friends', name: 'general', type: ChannelType.GuildText,
  }]);
  assert.deepEqual(requests, ['all', '10']);
});

test('guild refresh preserves reset cancellation instead of falling back to stale cache', async () => {
  const { client } = fixture();
  const controller = new AbortController();
  client.guilds.fetch = async () => {
    controller.abort();
    return new Map();
  };
  const source = createDiscordSource({ client, qaChannelId: '99', logger: { warn() {} } });

  await assert.rejects(source.listGuilds({ signal: controller.signal }), { name: 'AbortError' });
});

test('message pages are read live without mutating the source channel', async () => {
  const { client, channel } = fixture();
  const second = { ...(await channel.messages.fetch({ force: true, cache: false })), id: '101', content: 'second', createdTimestamp: 1700000001000 };
  let received;
  channel.messages.fetch = async options => {
    received = options;
    return new Map([['101', second], ['100', { ...second, id: '100', content: 'first', createdTimestamp: 1700000000000 }]]);
  };
  const source = createDiscordSource({ client, qaChannelId: '99' });
  const page = await source.readMessages('20', { before: '200', limit: 50 });

  assert.deepEqual(received, { limit: 50, before: '200', cache: false });
  assert.deepEqual(page.map(item => [item.id, item.authorName, item.content]), [
    ['101', 'Alice', 'second'], ['100', 'Alice', 'first'],
  ]);
});

test('message pages continue past empty records until the requested text count is filled', async () => {
  const { client, channel, message } = fixture();
  const calls = [];
  channel.messages.fetch = async options => {
    calls.push(options);
    if (!options.before) {
      return new Map([
        ['105', { ...message, id: '105', content: '' }],
        ['104', { ...message, id: '104', content: 'four' }],
        ['103', { ...message, id: '103', content: '' }],
      ]);
    }
    return new Map([
      ['102', { ...message, id: '102', content: 'two' }],
      ['101', { ...message, id: '101', content: 'one' }],
    ]);
  };
  const source = createDiscordSource({ client, qaChannelId: '99' });

  const page = await source.readMessages('20', { limit: 3 });

  assert.deepEqual(page.map(item => item.content), ['four', 'two', 'one']);
  assert.deepEqual(calls, [
    { limit: 3, cache: false },
    { limit: 2, cache: false, before: '103' },
  ]);
});
