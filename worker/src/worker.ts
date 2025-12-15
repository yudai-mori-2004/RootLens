// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Redis/BullMQ Deep Investigation Script
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import IORedis from 'ioredis';

const redisUrlRaw = process.env.REDIS_URL;
if (!redisUrlRaw) throw new Error('REDIS_URL is missing');

const urlObj = new URL(redisUrlRaw);

// ■ 検証する設定パターン
const config = {
  host: urlObj.hostname.includes('railway.internal') ? 'redis' : urlObj.hostname,
  port: parseInt(urlObj.port || '6379'),
  password: urlObj.password,
  username: undefined, // 明示的にundefined
  family: 0,
  showFriendlyErrorStack: true, // エラー詳細を表示
  enableOfflineQueue: false, // 接続前コマンドを即座にエラーにする（挙動確認用）
};

console.log('--- 🔍 Configuration Check ---');
console.log('Host:', config.host);
console.log('Port:', config.port);
console.log('User:', config.username);
console.log('Pass:', config.password ? `YES (Length: ${config.password.length})` : 'NO');
console.log('------------------------------');

async function runTests() {
  // 【テスト1】単発接続 & INFOコマンド (診断接続と同じ)
  console.log('\n--- 🧪 Test 1: Single Connection & INFO ---');
  const client1 = new IORedis(config);
  
  client1.on('error', (e) => console.log('   [Client1 Error]', e.message));
  
  try {
    await client1.connect();
    console.log('   ✅ Client1: Connected');
    const info = await client1.info();
    console.log('   ✅ Client1: INFO command success (First line):', info.split('\n')[0]);
  } catch (e) {
    console.log('   ❌ Client1: Failed', e);
  } finally {
    await client1.quit();
  }

  // 【テスト2】duplicate() の挙動確認 (BullMQはこれを使うことがある)
  console.log('\n--- 🧪 Test 2: Duplicate Connection ---');
  const primary = new IORedis(config);
  const duplicated = primary.duplicate();
  
  duplicated.on('error', (e) => console.log('   [Dup Error]', e.message));

  try {
    await duplicated.connect();
    console.log('   ✅ Duplicate: Connected');
    // 複製された接続がパスワードを保持しているか確認
    console.log('   🔎 Duplicate Options Password:', duplicated.options.password ? 'YES' : 'MISSING');
    
    const ping = await duplicated.ping();
    console.log('   ✅ Duplicate: PONG', ping);
  } catch (e) {
    console.log('   ❌ Duplicate: Failed', e);
  } finally {
    await primary.quit();
    await duplicated.quit();
  }

  // 【テスト3】同時多発接続 (BullMQの起動時挙動シミュレーション)
  // BullMQは起動時にBlocking用、Sub用など複数の接続を一気に作る
  console.log('\n--- 🧪 Test 3: Concurrency / Race Condition Check ---');
  const clients = [];
  try {
    for (let i = 0; i < 3; i++) {
      console.log(`   🚀 Starting Client ${i}...`);
      const c = new IORedis(config);
      c.on('error', (err) => console.log(`   [Client ${i} Error]`, err.message));
      // わざとawaitせずに次へ進む（非同期競合の誘発）
      clients.push(c);
    }

    // 全員がPINGを通せるか
    await Promise.all(clients.map(async (c, i) => {
      // 少し待ってからコマンド
      await new Promise(r => setTimeout(r, 100)); 
      const res = await c.ping();
      console.log(`   ✅ Client ${i}: PONG`, res);
      await c.quit();
    }));
  } catch (e) {
    console.log('   ❌ Concurrency Test Failed', e);
  }
}

runTests().catch(console.error);