/**
 * Pending trade recommendation manager.
 * Stores trade recommendations awaiting human approval before execution.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import crypto from 'crypto';

const PENDING_PATH = new URL('../../data/pending.json', import.meta.url).pathname;
const EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

function ensureDir(p) { mkdirSync(dirname(p), { recursive: true }); }

function load() {
  if (!existsSync(PENDING_PATH)) return [];
  return JSON.parse(readFileSync(PENDING_PATH, 'utf8'));
}

function save(pending) {
  ensureDir(PENDING_PATH);
  writeFileSync(PENDING_PATH, JSON.stringify(pending, null, 2));
}

/** Expire old pending trades. Mutates and saves. */
function expireOld(pending) {
  const now = Date.now();
  let changed = false;
  for (const t of pending) {
    if (t.status === 'pending' && new Date(t.expiresAt).getTime() <= now) {
      t.status = 'expired';
      changed = true;
    }
  }
  if (changed) save(pending);
  return pending;
}

/**
 * Add a new pending trade recommendation.
 * @returns {Object} the created recommendation
 */
export function addPending({ strategy, contract, side, qty, price, edge, reasoning }) {
  const pending = load();
  const now = new Date();
  const rec = {
    id: crypto.randomBytes(4).toString('hex'),
    strategy: strategy || 'weather',
    contract,
    side,
    qty,
    price,
    edge,
    reasoning: reasoning || '',
    status: 'pending',
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + EXPIRY_MS).toISOString(),
  };
  pending.push(rec);
  save(pending);
  return rec;
}

/** Get all pending (non-expired) recommendations. */
export function getPending() {
  const pending = expireOld(load());
  return pending.filter(t => t.status === 'pending');
}

/** Get all recommendations (any status). */
export function getAll() {
  return expireOld(load());
}

/** Find a recommendation by ID. */
export function findById(id) {
  const pending = expireOld(load());
  return pending.find(t => t.id === id);
}

/** Update status of a recommendation. */
export function updateStatus(id, status) {
  const pending = load();
  const rec = pending.find(t => t.id === id);
  if (!rec) throw new Error(`Trade ${id} not found`);
  if (rec.status !== 'pending') throw new Error(`Trade ${id} is ${rec.status}, not pending`);
  rec.status = status;
  rec.updatedAt = new Date().toISOString();
  save(pending);
  return rec;
}

/** Mark as executed with fill details. */
export function markExecuted(id, fillDetails = {}) {
  const pending = load();
  const rec = pending.find(t => t.id === id);
  if (!rec) throw new Error(`Trade ${id} not found`);
  rec.status = 'executed';
  rec.updatedAt = new Date().toISOString();
  rec.fill = fillDetails;
  save(pending);
  return rec;
}
