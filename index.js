import { createClient } from '@retconned/kick-js';
import 'dotenv/config';

const config = {
  kickChannel: process.env.KICK_CHANNEL || 'DylanJamesGG',
  webhookSecret: process.env.WEBHOOK_SECRET,
  supabaseUrl: process.env.SUPABASE_URL || 'https://idpcknsxscpqquguuffi.supabase.co',
};

if (!config.webhookSecret) {
  console.error('❌ WEBHOOK_SECRET is required');
  process.exit(1);
}

let activeMatchId = null;
let activeBonusRoundId = null;

async function sendWebhook(endpoint, payload) {
  const response = await fetch(`${config.supabaseUrl}/functions/v1/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': config.webhookSecret },
    body: JSON.stringify(payload),
  });
  return { success: response.ok, result: await response.json() };
}

async function handleVote(id, username, choice) {
  if (!activeMatchId) return console.log(`[VOTE] No active match`);
  const { success } = await sendWebhook('vote-webhook', { match_id: activeMatchId, kick_user_id: id, kick_username: username, choice: parseInt(choice) });
  console.log(`[VOTE] ${username} voted ${choice}: ${success ? 'OK' : 'FAILED'}`);
}

async function handleBonus(id, username, amount) {
  if (!activeBonusRoundId) return console.log(`[BONUS] No active bonus round`);
  const { success } = await sendWebhook('bonus-guess-webhook', { bonus_round_id: activeBonusRoundId, kick_user_id: id, kick_username: username, guess_amount: parseFloat(amount) });
  console.log(`[BONUS] ${username} guessed ${amount}: ${success ? 'OK' : 'FAILED'}`);
}

async function handleLink(id, username, code) {
  const { success, result } = await sendWebhook('link-kick-account', { kick_user_id: id, kick_username: username, code: code.toUpperCase() });
  console.log(`[LINK] ${username}: ${success ? 'linked!' : result?.error || 'failed'}`);
}

function processMessage(msg) {
  const text = msg.content?.trim();
  if (!text) return;
  const { id, username } = msg.sender;

  if (/^!(?:vote\s*)?([12])$/i.test(text)) return handleVote(String(id), username, text.match(/([12])/)[1]);
  if (/^!guess\s+(\d+(?:\.\d+)?)$/i.test(text)) return handleBonus(String(id), username, text.match(/(\d+(?:\.\d+)?)/)[1]);
  if (/^!link\s+([A-Z0-9]{6})$/i.test(text)) return handleLink(String(id), username, text.match(/([A-Z0-9]{6})/i)[1]);
  if (/^!setmatch\s+(.+)$/i.test(text)) { activeMatchId = text.split(' ')[1]; console.log(`[ADMIN] Match: ${activeMatchId}`); }
  if (/^!setbonus\s+(.+)$/i.test(text)) { activeBonusRoundId = text.split(' ')[1]; console.log(`[ADMIN] Bonus: ${activeBonusRoundId}`); }
  if (text === '!clearmatch') { activeMatchId = null; console.log('[ADMIN] Match cleared'); }
  if (text === '!clearbonus') { activeBonusRoundId = null; console.log('[ADMIN] Bonus cleared'); }
}

const client = createClient('DylanJamesGG', { logger: false, readOnly: true });
client.on('ready', () => console.log('✅ Connected to DylanJamesGG chat!'));
client.on('ChatMessage', processMessage);
client.on('error', (e) => console.error('❌ Error:', e.message));
