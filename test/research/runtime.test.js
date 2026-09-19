const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Events, ChannelType, PermissionsBitField, PermissionFlagsBits: P } = require('discord.js');
const { setImmediate: nextTurn } = require('node:timers/promises');
const { createStore } = require('../../src/research/store');
const { createRuntime } = require('../../src/research/runtime');

function fixture() {
  const client = new EventEmitter();
  client.user = { id: 'pat' };
  client.isReady = () => true;
  client.login = async () => { throw new Error('Research must not log in a second client'); };
  client.destroy = async () => { throw new Error('Research must not disconnect Pat'); };
  const everyone = { id: '10', permissions: new PermissionsBitField([]) };
  const guild = { id: '10', name: 'Friends', members: { me: { id: 'pat' } }, roles: { everyone, cache: new Map([['10', everyone]]) } };
  guild.roles.fetch = async () => guild.roles.cache;
  const qa = { id: '99', type: ChannelType.GuildText, guild,
    permissionOverwrites: { cache: new Map() },
    permissionsFor: subject => new PermissionsBitField(subject.id === '10' ? [] : [P.ViewChannel, P.ReadMessageHistory, P.SendMessages]) };
  client.channels = { fetch: async () => qa };
  const store = createStore(':memory:');
  const source = { discover: async () => [], canRead: c => c.id !== '99', record: m => ({ id: m.id, channelId: m.channelId, guildId: m.guildId, guildName: 'Friends', channelName: 'general', content: m.content, authorId: '30', authorName: 'Alice', createdAt: 1700000000000 }) };
  const config = { qaChannelId: '99', pagesPerChannel: 1, syncIntervalMs: 60000 };
  const runtime = createRuntime({ client, store, source, config, model: {}, logger: { warn() {}, log() {} } });
  const message = { id: '100', guildId: '10', channelId: '20', channel: { id: '20' }, author: { id: '30' }, content: 'pizza' };
  return { client, store, runtime, message, qa };
}

test('live create, edit, delete and bulk delete events update the independent search index', async () => {
  const { client, store, runtime, message } = fixture();
  try {
    await runtime.start();
    client.emit(Events.MessageCreate, message);
    await nextTurn();
    assert.equal(store.search(['pizza']).length, 1);
    client.emit(Events.MessageUpdate, message, { ...message, content: 'sushi' });
    await nextTurn();
    assert.equal(store.search(['pizza']).length, 0);
    assert.equal(store.search(['sushi']).length, 1);
    client.emit(Events.MessageDelete, { id: '100' });
    await nextTurn();
    assert.equal(store.stats().messages, 0);
    client.emit(Events.MessageCreate, message);
    await nextTurn();
    client.emit(Events.MessageBulkDelete, new Map([['100', message]]));
    await nextTurn();
    assert.equal(store.stats().messages, 0);
  } finally { await runtime.stop(); }
});

test('a disconnected shared client prevents indexing and live ingestion', async () => {
  const { client, store, runtime, message } = fixture();
  client.isReady = () => false;
  try {
    await assert.rejects(runtime.start(), /connected/);
    client.emit(Events.MessageCreate, message);
    await nextTurn();
    assert.equal(store.stats().messages, 0);
  } finally { await runtime.stop(); }
});

test('startup rejects a public Q&A channel', async () => {
  const { runtime, qa } = fixture();
  qa.permissionsFor = () => new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory, P.SendMessages]);
  try { await assert.rejects(runtime.start(), /private/i); } finally { await runtime.stop(); }
});

test('a Q&A channel opened to everyone after startup receives no status or answers', async () => {
  const { runtime, qa, client } = fixture();
  const sent = [];
  qa.send = async payload => sent.push(payload);
  try {
    await runtime.start();
    qa.permissionsFor = () => new PermissionsBitField([P.ViewChannel, P.ReadMessageHistory, P.SendMessages]);
    client.emit(Events.MessageCreate, { id: '200', guildId: '10', channelId: '99', channel: qa, author: { id: 'owner' }, content: '!status' });
    await nextTurn();
    assert.equal(sent.length, 0);
  } finally { await runtime.stop(); }
});
