// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔍 Deep Diagnostic Mode: Redis Connection & Auth
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
import IORedis from 'ioredis';
import { startServer } from './server'; // ヘルスチェック用（デプロイ成功させるため）

const redisUrlRaw = process.env.REDIS_URL;
if (!redisUrlRaw) {
  console.error('❌ REDIS_URL missing');
  process.exit(1);
}

// URL解析
const urlObj = new URL(redisUrlRaw);
const originalHost = urlObj.hostname;
const shortHost = 'redis'; // Railway内部DNS短縮名

console.log(`\n🕵️ DIAGNOSIS STARTED`);
console.log(`Original Host: ${originalHost}`);
console.log(`Pass Length: ${urlObj.password.length}`);

// ヘルパー: 接続テスト関数
async function testConnection(label: string, client: IORedis) {
  console.log(`\n--- [TEST: ${label}] Starting ---`);
  
  return new Promise<void>((resolve) => {
    // タイムアウト設定
    const timeout = setTimeout(() => {
      console.log(`   ⏰ [${label}] Timeout - Force Quitting`);
      client.disconnect();
      resolve();
    }, 5000);

    client.on('connect', () => console.log(`   ✅ [${label}] TCP Connected`));
    client.on('ready', () => console.log(`   ✅ [${label}] Redis Ready (Auth Success)`));
    
    client.on('error', (err) => {
      // NOAUTHはここで捕捉されることが多い
      console.log(`   ❌ [${label}] Error: ${err.message}`);
    });

    // PING試行
    client.ping().then((res) => {
      console.log(`   🎉 [${label}] PING Result: ${res}`);
      clearTimeout(timeout);
      client.quit().then(() => resolve());
    }).catch((err) => {
      console.log(`   💥 [${label}] PING Failed: ${err.message}`);
      // ここで認証エラーの詳細が出るはず
    });
  });
}

async function runDiagnosis() {
  // ---------------------------------------------------------
  // パターンA: URL文字列にパラメータを埋め込んで渡す (ioredis推奨)
  // ---------------------------------------------------------
  const urlWithFamily = new URL(redisUrlRaw??"redisUrlRaw is undefined");
  urlWithFamily.searchParams.set('family', '0'); // IPv6
  
  // usernameを削除してみる (ACL競合回避)
  urlWithFamily.username = ''; 
  
  const urlString = urlWithFamily.toString();
  console.log(`\n📋 Pattern A URL: ${urlString.replace(/:[^:@]*@/, ':****@')}`);
  
  const clientA = new IORedis(urlString, { 
    maxRetriesPerRequest: null,
    lazyConnect: true // 手動接続テストのため
  });
  
  // 手動connect (lazyConnect: trueなのでエラーにならない)
  await clientA.connect().catch(e => console.log(`   [A] Connect Error: ${e.message}`));
  await testConnection('Pattern A (Pure URL)', clientA);


  // ---------------------------------------------------------
  // パターンB: 設定オブジェクト (Host: 'redis', User: undefined)
  // ---------------------------------------------------------
  const configB = {
    host: shortHost, // 'redis'
    port: 6379,
    password: urlObj.password,
    username: undefined, // 明示的に除外
    family: 0,
    lazyConnect: true
  };
  
  const clientB = new IORedis(configB);
  await clientB.connect().catch(e => console.log(`   [B] Connect Error: ${e.message}`));
  await testConnection('Pattern B (Config Object)', clientB);


  // ---------------------------------------------------------
  // パターンC: BullMQシミュレーション (duplicate時の挙動)
  // ---------------------------------------------------------
  console.log('\n--- [TEST: Pattern C (BullMQ Simulation)] ---');
  // 最も成功率の高そうな設定で親を作る
  const parent = new IORedis(urlString, { family: 0, lazyConnect: true });
  
  try {
    await parent.connect();
    console.log('   ✅ [Parent] Connected');
    
    // BullMQはここで .duplicate() を呼ぶ
    // このとき、親の接続オプションが正しく引き継がれるか？
    console.log('   🔄 Calling .duplicate()...');
    const child = parent.duplicate();
    
    child.on('error', err => console.log(`   ❌ [Child] Error: ${err.message}`));
    
    await child.connect(); // 子接続開始
    console.log('   ✅ [Child] TCP Connected');
    
    const res = await child.ping();
    console.log(`   🎉 [Child] PING Result: ${res}`);
    
    await child.quit();
  } catch (err) {
    console.log(`   💥 [Pattern C] Failed: ${err}`);
  } finally {
    await parent.quit();
  }
  
  console.log('\n🏁 DIAGNOSIS COMPLETE');
}

// サーバー起動（RailwayのHealth checkを通すため）
startServer();

// 診断開始
runDiagnosis().catch(err => console.error('FATAL:', err));