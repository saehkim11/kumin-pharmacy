/* Dashboard news must never point to a download or an unapproved host. */
const fs = require('fs');
const path = require('path');

const workspace = path.resolve(__dirname, '..');
const news = JSON.parse(fs.readFileSync(path.join(workspace, 'data', 'dashboard-news.json'), 'utf8'));
const allowedOrigins = new Set([
  'https://www.mafra.go.kr', 'https://news.seoul.go.kr', 'https://www.koreadognews.co.kr', 'https://www.dailyvet.co.kr'
]);
const blockedPath = /(download|export|\.csv$|\.xlsx?$|\.pdf$|\.zip$)/i;

async function verify() {
  if (!Array.isArray(news.items)) throw new Error('뉴스 목록 형식이 올바르지 않습니다.');
  for (const item of news.items) {
    const url = new URL(item.url);
    if (!allowedOrigins.has(url.origin)) throw new Error(`허용되지 않은 뉴스 출처: ${url.origin}`);
    if (blockedPath.test(url.pathname)) throw new Error(`파일 내려받기 주소는 뉴스에 사용할 수 없습니다: ${url.pathname}`);
  }
  console.log(`뉴스 링크 안전 확인 통과: ${news.items.length}건`);
}

verify().catch((error) => { console.error(error.message); process.exitCode = 1; });
