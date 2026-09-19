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
