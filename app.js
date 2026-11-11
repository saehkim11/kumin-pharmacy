const menuButtons = document.querySelectorAll('.nav-button');
const views = document.querySelectorAll('.view');
const pageTitle = document.querySelector('#pageTitle');
const config = window.APP_CONFIG;
const loginDialog = document.querySelector('#loginDialog');
const loginButton = document.querySelector('#loginButton');
const themeToggle = document.querySelector('#themeToggle');
const themeIcon = document.querySelector('#themeIcon');
const productSearch = document.querySelector('#productSearch');
const productRows = document.querySelector('#productRows');
const productTableWrap = document.querySelector('#productTableWrap');
const productMessage = document.querySelector('#productMessage');
const ledgerMonth = document.querySelector('#ledgerMonth');
const ledgerSummary = document.querySelector('#ledgerSummary');
let accessToken = '';
let products = [];
let saleItems = [];
let purchaseItems = [];
let suppliers = [];
let currentUser = null;
let currentProfile = null;
let tasks = [];
let selectedTask = null;
let taskComments = new Map(); // 업무별 댓글 목록(작성자·시간만): 말풍선 표시용
let calendarDate = new Date();
let teamMembers = [];
let activeSuggestionIndex = -1;
let analyticsSales = [];
let analyticsProfit = []; // 판매항목별 매출·원가 (이익 분석용, admin 전용)
let analyticsSaleItems = [];
let selectedAnalyticsYear = '';
let selectedAnalyticsMonth = null; // null이면 최근 판매월, 0이면 연초부터 누계, 1~12는 해당 월
let analyticsWeather = [];
let analyticsForecast = null;
let analyticsForecastError = '';
let inventoryMovements = [];
let selectedLedgerMonth = '';
let legacySales = [];
let selectedLegacySalesMonth = '';
let salesHistoryRows = []; // 선택한 월의 판매항목(일자·상품·수량·금액)
let salesHistoryView = 'daily';

const saleProductSearch = document.querySelector('#saleProductSearch');
const saleProductValue = document.querySelector('#saleProduct');
const saleProductSuggestions = document.querySelector('#saleProductSuggestions');
const saleProductHint = document.querySelector('#saleProductHint');
const recentProductStorageKey = 'pharmacy-recent-products';
const saleDate = document.querySelector('#saleDate');
const salePetSearch = document.querySelector('#salePetSearch');
const salePetId = document.querySelector('#salePetId');
const salePetOptions = document.querySelector('#salePetOptions');
const salePetHistorySection = document.querySelector('#salePetHistorySection');
const salePetHistoryTitle = document.querySelector('#salePetHistoryTitle');
const salePetHistoryRows = document.querySelector('#salePetHistoryRows');
const salePetHistoryEmpty = document.querySelector('#salePetHistoryEmpty');
const salesHistorySection = document.querySelector('#salesHistorySection');
const petPurchaseRows = document.querySelector('#petPurchaseRows');
const petPurchaseEmpty = document.querySelector('#petPurchaseEmpty');
let salePetDirectory = new Map(); // label(이름(보호자)) -> pet_id, 판매 등록 시 반려동물 연결용

async function loadSalePetOptions() {
  try {
    const rows = await apiAll('pets?select=id,name,owner:owners(name)');
    const labelCount = new Map();
    rows.forEach((pet) => { const base = `${pet.name} (${pet.owner?.name || '보호자미상'})`; labelCount.set(base, (labelCount.get(base) || 0) + 1); });
    salePetDirectory = new Map();
    rows.forEach((pet) => {
      const base = `${pet.name} (${pet.owner?.name || '보호자미상'})`;
      const label = labelCount.get(base) > 1 ? `${base} #${pet.id}` : base;
      salePetDirectory.set(label, pet.id);
    });
    salePetOptions.replaceChildren(...[...salePetDirectory.keys()].sort().map((label) => new Option(label)));
  } catch {
    // 자동완성 실패해도 판매 등록 자체는 계속 가능해야 함
  }
}

// 반려동물을 선택하면 하단을 전체 월별 내역 대신 그 반려동물의 구매 이력으로 전환
async function updateSalePetHistory() {
  const label = salePetSearch.value.trim();
  const petId = label ? salePetDirectory.get(label) : null;
  if (!petId) {
    salePetHistorySection.hidden = true;
    salesHistorySection.hidden = false;
    return;
  }
  salesHistorySection.hidden = true;
  salePetHistorySection.hidden = false;
  salePetHistoryTitle.textContent = `구매 이력 — ${label}`;
  try {
    const rows = await apiAll(`sale_items?select=quantity,amount,products(name),sales(sold_at)&pet_id=eq.${petId}`);
    rows.sort((a, b) => (b.sales?.sold_at || '').localeCompare(a.sales?.sold_at || ''));
    if (!rows.length) {
      salePetHistoryRows.replaceChildren();
      salePetHistoryEmpty.hidden = false;
    } else {
      salePetHistoryEmpty.hidden = true;
      salePetHistoryRows.replaceChildren(...rows.map((row) => {
        const tr = document.createElement('tr');
        [row.sales?.sold_at?.slice(0, 10) || '—', row.products?.name || '—', row.quantity, `${Math.round(row.amount).toLocaleString('ko-KR')}원`].forEach((value) => {
          const cell = document.createElement('td'); cell.textContent = value; tr.append(cell);
        });
        return tr;
      }));
    }
  } catch {
    salePetHistoryRows.replaceChildren();
    salePetHistoryEmpty.hidden = false;
  }
}
const purchaseSupplier = document.querySelector('#purchaseSupplier');
const purchaseDate = document.querySelector('#purchaseDate');
const purchaseProductSearch = document.querySelector('#purchaseProductSearch');
const purchaseProductOptions = document.querySelector('#purchaseProductOptions');
const purchaseQuantity = document.querySelector('#purchaseQuantity');
const purchaseUnitCost = document.querySelector('#purchaseUnitCost');
const purchaseLotNo = document.querySelector('#purchaseLotNo');
const purchaseExpiryDate = document.querySelector('#purchaseExpiryDate');

const petSearchInput = document.querySelector('#petSearchInput');
const petMicButton = document.querySelector('#petMicButton');
const petSearchButton = document.querySelector('#petSearchButton');
const petSearchMessage = document.querySelector('#petSearchMessage');
const petSearchHint = document.querySelector('#petSearchHint');
const petCandidatesWrap = document.querySelector('#petCandidatesWrap');
const petCandidateRows = document.querySelector('#petCandidateRows');
const petDetailPanel = document.querySelector('#petDetailPanel');
const petDetailName = document.querySelector('#petDetailName');
const petDetailInfo = document.querySelector('#petDetailInfo');
const petDetailNotes = document.querySelector('#petDetailNotes');
const petVisitRows = document.querySelector('#petVisitRows');
const petVisitEmpty = document.querySelector('#petVisitEmpty');
const petSpeciesLabel = { dog: '강아지', cat: '고양이', unknown: '미상' };
const petSexLabel = { male: '수컷', female: '암컷', unknown: '미상' };
const petVisitForm = document.querySelector('#petVisitForm');
const petVisitDate = document.querySelector('#petVisitDate');
const petVisitRecord = document.querySelector('#petVisitRecord');
const petVisitDetail = document.querySelector('#petVisitDetail');
const petVisitFormMessage = document.querySelector('#petVisitFormMessage');
const petVisitRecordOptions = document.querySelector('#petVisitRecordOptions');
const petVisitDetailOptions = document.querySelector('#petVisitDetailOptions');
const newPetToggle = document.querySelector('#newPetToggle');
const newPetDialog = document.querySelector('#newPetDialog');
const newPetForm = document.querySelector('#newPetForm');
const newPetFormMessage = document.querySelector('#newPetFormMessage');
const salePetNewButton = document.querySelector('#salePetNewButton');
let selectedPetId = null;

// 많이 쓰인 진료기록/상세 문구를 빈도순으로 datalist에 채워 자동완성으로 재사용할 수 있게 함
async function loadPetVisitSuggestions() {
  try {
    const response = await apiAll('pet_visits?select=record,detail');
    const rank = (rows, field) => {
      const counts = new Map();
      rows.forEach((row) => {
        const value = row[field]?.trim();
        if (value) counts.set(value, (counts.get(value) || 0) + 1);
      });
      return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value]) => value).slice(0, 300);
    };
    petVisitRecordOptions.replaceChildren(...rank(response, 'record').map((value) => new Option(value)));
    petVisitDetailOptions.replaceChildren(...rank(response, 'detail').map((value) => new Option(value)));
  } catch {
    // 자동완성은 부가 기능이라 실패해도 등록 자체는 계속 가능해야 함
  }
}

const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
let petRecognition = null;
if (SpeechRecognitionCtor) {
  petRecognition = new SpeechRecognitionCtor();
  petRecognition.lang = 'ko-KR';
  petRecognition.interimResults = false;
  petRecognition.maxAlternatives = 1;
  petRecognition.addEventListener('result', (event) => {
    const text = event.results[0][0].transcript.trim();
    petSearchInput.value = text;
    searchPets(text);
  });
  petRecognition.addEventListener('end', () => petMicButton.classList.remove('listening'));
  petRecognition.addEventListener('error', (event) => {
    petMicButton.classList.remove('listening');
    petSearchMessage.textContent = event.error === 'not-allowed' ? '마이크 권한을 허용해 주세요.' : '음성 인식에 실패했습니다. 다시 시도하거나 직접 입력해 주세요.';
  });
} else {
  petMicButton.title = '이 브라우저는 음성 인식을 지원하지 않습니다. 직접 입력해 주세요.';
}

function getSeasonalitySettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('pharmacy-seasonality-settings') || '{}');
    return {
      threshold: Number(saved.threshold) || 30,
      leadDays: Number(saved.leadDays) || 5
    };
  } catch {
    return { threshold: 30, leadDays: 5 };
  }
}

function dateKey(value) {
  return value.toISOString().slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

function sameDayPreviousYear(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return dateKey(date);
}

function formatDate(value) {
  const [, month, day] = value.split('-');
  return `${Number(month)}월 ${Number(day)}일`;
}

function getLocalDate() {
  const now = new Date();
  const timezoneOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - timezoneOffset).toISOString().slice(0, 10);
}

function api(path, options = {}) {
  return fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...options,
    headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
  });
}

// 서버가 한 번에 주는 행 수(보통 1000)를 넘는 데이터도 빠짐없이 받기 위해 나눠서 불러옴
async function apiAll(path) {
  const pageSize = 1000;
  const rows = [];
  for (let start = 0; ; start += pageSize) {
    const response = await api(path, { headers: { Range: `${start}-${start + pageSize - 1}`, 'Range-Unit': 'items' } });
    if (!response.ok) throw new Error('데이터를 불러오지 못했습니다.');
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// apiAll 결과를 기존 fetch 응답처럼 쓸 수 있게 감싸는 함수
async function apiAllResponse(path) {
  try {
    const rows = await apiAll(path);
    return { ok: true, json: async () => rows };
  } catch (error) {
    return { ok: false, json: async () => [] };
  }
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

menuButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const viewId = button.dataset.view;
    menuButtons.forEach((item) => item.classList.toggle('active', item === button));
    views.forEach((view) => view.classList.toggle('active', view.id === viewId));
    pageTitle.textContent = button.textContent;
    window.location.hash = viewId;
  });
});

// ---------- 사이트 구조 (관리자 전용 지도) ----------
// 화면을 추가하거나 바꾸면 아래 목록도 같이 고쳐 주세요. insight 번호는 아래 siteInsights와 연결됩니다.
const siteTreeData = {
  label: '약국 ERP', full: 'pharmacy management', access: 'all', note: '로그인 후 역할(admin, staff)에 따라 메뉴가 달라지는 약국 업무 사이트입니다.', children: [
    { label: '대시보드', full: '대시보드', access: 'all', note: '오늘 매출 등 핵심 숫자와 매출 그래프를 한눈에 보는 첫 화면입니다.', children: [
      { label: '요약 카드', full: '요약 카드 4개', access: 'all', note: '오늘 매출 · 판매 건수 · 재고 확인 필요 · 이번 달 마진율(admin 전용 지표)', data: ['sales', 'products', 'sale_items', 'v_sale_items_profit'], insight: 2 },
      { label: '매출 분석', full: '매출·상품 분석', access: 'admin', note: '연도별 월 매출 그래프와 분류별 전년 대비 증감. 월 버튼을 누르면 두 영역이 함께 바뀝니다.', data: ['sales', 'sale_items'], insight: 3 }
    ] },
    { label: '판매', full: '판매 관리', access: 'all', note: '판매를 등록하고 월별 판매 내역을 확인합니다.', children: [
      { label: '판매 등록', full: '판매 등록', access: 'all', note: '상품 검색 → 수량 → 판매일 → 목록 담기 → 결제수단 → 등록', data: ['rpc_create_sale', 'products'] },
      { label: '판매 내역', full: '월별 판매 내역', access: 'all', note: '일자별 · 품목별 판매수량과 매출액', data: ['sales', 'sale_items'], insight: 2 }
    ] },
    { label: '고객·반려동물 관리', full: '고객·반려동물 관리', access: 'all', note: '이름을 음성 또는 텍스트로 검색해 보호자 연락처, 진료·접종·약구매 이력을 확인하고 신규 보호자·반려동물을 등록합니다.', data: ['pets', 'owners', 'pet_visits'] },
    { label: '입고', full: '입고 관리', access: 'admin', note: '입고를 등록하고 재고 수불부를 확인합니다. 직원에게는 메뉴가 보이지 않습니다.', insight: 1, children: [
      { label: '입고 등록', full: '입고 등록', access: 'admin', note: '거래처 · 입고일 · 단가 · 로트 · 유효기간', data: ['rpc_receive_purchase', 'suppliers'] },
      { label: '수불부', full: '월별 재고 수불부', access: 'admin', note: '기초 · 입고 · 출고 · 재고 수량', data: ['inventory_movements', 'products'], insight: 1 }
    ] },
    { label: '공유 업무', full: '공유 업무', access: 'all', note: '업무를 달력으로 공유하고 상태와 댓글로 진행 상황을 남깁니다.', children: [
      { label: '업무 달력', full: '업무 달력', access: 'all', note: '날짜별 업무와 댓글 말풍선(읽음·안 읽음)', data: ['action_tasks', 'task_comments'], insight: 4 },
      { label: '업무 상세', full: '업무 상세', access: 'all', note: '상태 변경 · 댓글 (담당자와 admin)', data: ['task_assignees', 'task_comments'] },
      { label: '업무 등록', full: '새 업무 등록', access: 'admin', note: '대표(admin)가 담당자를 정해 새 업무를 만듭니다.', data: ['action_tasks', 'profiles'] }
    ] },
    { label: '분석', full: '분석', access: 'admin', note: '매출 지표와 날씨·계절 수요를 깊이 있게 보는 화면입니다.', children: [
      { label: '매출 KPI', full: '매출 KPI', access: 'admin', note: '매출 · 주문 · 판매 수량 · 평균 주문금액', data: ['sales', 'sale_items'], insight: 3 },
      { label: '계절 알림', full: '날씨·계절 수요 알림', access: 'admin', note: '전년 동일 시점 수요 비교와 서울 7일 예보', data: ['environmental_data', '외부 예보(open-meteo)'], insight: 5 }
    ] },
    { label: '매출관리', full: '매출관리', access: 'admin', note: '가져오기 전 과거 매출(sales_legacy) 3,507건을 월별·상품명으로 조회합니다. 조회 전용, 신규 판매 등록은 판매 관리에서 합니다.', data: ['sales_legacy'] },
    { label: '사이트 구조', full: '사이트 구조', access: 'admin', note: '지금 보고 계신 화면입니다.' },
    { label: '로그인', full: '로그인 · 권한', access: 'all', note: '로그인하면 왼쪽 아래에 현재 권한(admin 또는 staff)이 표시되고 메뉴 노출이 정해집니다.', data: ['Auth', 'profiles'] }
  ]
};

const siteInsights = [
  { title: '직원(staff)에게 재고 확인 화면이 없음', text: '입고 관리 메뉴(입고 등록과 재고 수불부)가 admin 전용이고, 입고 등록 기능도 DB에서 admin만 허용합니다. 직원이 판매 중 재고를 확인할 전용 화면이 없습니다.', idea: '재고 조회만 읽기 전용으로 직원에게 열어주는 방안을 검토해 볼 수 있습니다.' },
  { title: '같은 판매 데이터를 여러 곳에서 따로 불러옴', text: '로그인할 때 대시보드, 분석, 판매 내역, 재고 알림이 각각 sales와 sale_items를 새로 요청합니다.', idea: '한 번 받은 데이터를 공유하면 첫 로딩이 빨라지고 화면 간 숫자도 어긋나지 않습니다.' },
  { title: '대시보드와 분석 메뉴의 역할이 겹침', text: '매출 그래프와 분류 증감은 대시보드에, 매출 KPI는 분석 메뉴에 있어 둘 다 같은 판매 데이터를 다른 모습으로 보여줍니다.', idea: '대시보드는 오늘의 판단용, 분석은 깊이 보기용으로 기준을 정하면 사용자가 찾기 쉽습니다.' },
  { title: '공유 업무 달력은 한 칸에 업무 2개만 표시', text: '한 날짜에 업무가 3개 이상이면 2개만 보이고, 날짜를 누르면 첫 번째 업무만 열립니다.', idea: '날짜를 누르면 그날 업무 목록을 보여주는 방식을 검토해 볼 수 있습니다.' },
  { title: '날씨 예보를 외부 서비스에 의존', text: '서울 7일 예보를 외부 서비스(open-meteo)에서 받아옵니다. 서비스가 응답하지 않으면 예보 부분은 안내 문구로 대체됩니다.', idea: '장애 시 안내가 충분한지 점검하고, 매장 위치가 서울이 맞는지 확인해 볼 수 있습니다.' }
];

function renderSiteStructure() {
  const countNodes = (node) => 1 + (node.children || []).reduce((sum, child) => sum + countNodes(child), 0);
  const tables = new Set();
  const collect = (node) => { (node.data || []).forEach((item) => tables.add(item)); (node.children || []).forEach(collect); };
  collect(siteTreeData);
  const menus = siteTreeData.children;
  const stats = document.querySelector('#structureStats');
  stats.replaceChildren(...[
    ['메뉴', menus.length], ['화면 영역', countNodes(siteTreeData) - menus.length - 1],
    ['admin 전용 메뉴', menus.filter((menu) => menu.access === 'admin').length], ['연결 데이터', tables.size], ['개선 포인트', siteInsights.length]
  ].map(([name, value]) => { const card = document.createElement('div'); card.innerHTML = '<strong></strong><span></span>'; card.querySelector('strong').textContent = value; card.querySelector('span').textContent = name; return card; }));

  const dialog = document.querySelector('#structureDialog');
  // 항목을 누르면 설명이 팝업으로 열림
  const openNodeDialog = (node) => {
    document.querySelector('#structureDialogEyebrow').textContent = node.access === 'admin' ? 'ADMIN 전용' : '전체 공통';
    document.querySelector('#structureDialogTitle').textContent = node.full;
    const body = document.querySelector('#structureDialogBody');
    body.replaceChildren();
    if (node.note) { const note = document.createElement('p'); note.className = 'dialog-note'; note.textContent = node.note; body.append(note); }
    if (node.data?.length) {
      const label = document.createElement('p'); label.className = 'dialog-label'; label.textContent = '연결된 데이터';
      const chips = document.createElement('div'); chips.className = 'tree-data';
      node.data.forEach((name) => { const chip = document.createElement('span'); chip.className = 'tag data'; chip.textContent = name; chips.append(chip); });
      body.append(label, chips);
    }
    if (node.insight) {
      const insight = siteInsights[node.insight - 1];
      const box = document.createElement('div'); box.className = 'dialog-insight';
      box.innerHTML = '<b></b><p></p><p class="insight-idea"></p>';
      box.querySelector('b').textContent = `개선 포인트 ${node.insight}. ${insight.title}`;
      box.querySelectorAll('p')[0].textContent = insight.text;
      box.querySelector('.insight-idea').textContent = `검토할 점: ${insight.idea}`;
      body.append(box);
    }
    dialog.showModal();
  };
  const makeButton = (node) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `org-node ${node.access}`;
    button.textContent = node.label;
    if (node.insight) { const flag = document.createElement('span'); flag.className = 'insight-flag'; flag.textContent = node.insight; button.append(flag); }
    button.setAttribute('aria-label', `${node.full} 설명 보기`);
    button.addEventListener('click', () => openNodeDialog(node));
    return button;
  };
  // 위(사이트) → 가운데(메뉴) → 아래(세부 화면) 순서로 그림
  const chart = document.querySelector('#siteTree');
  const root = document.createElement('div'); root.className = 'org-root'; root.append(makeButton(siteTreeData));
  const menuRow = document.createElement('ul'); menuRow.className = 'org-menus';
  siteTreeData.children.forEach((menu) => {
    const menuItem = document.createElement('li');
    menuItem.append(makeButton(menu));
    if (menu.children?.length) {
      const leaves = document.createElement('ul'); leaves.className = 'org-leaves';
      menu.children.forEach((leaf) => { const leafItem = document.createElement('li'); leafItem.append(makeButton(leaf)); leaves.append(leafItem); });
      menuItem.append(leaves);
    }
    menuRow.append(menuItem);
  });
  chart.replaceChildren(root, menuRow);
  if (!dialog.dataset.ready) {
    dialog.dataset.ready = '1';
    document.querySelector('#structureDialogClose').addEventListener('click', () => dialog.close());
    dialog.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  }
  document.querySelector('#structureInsights').replaceChildren(...siteInsights.map((insight, index) => {
    const card = document.createElement('article');
    card.className = 'insight-card'; card.id = `insight-${index + 1}`;
    card.innerHTML = '<span class="insight-no"></span><div><h4></h4><p></p><p class="insight-idea"></p></div>';
    card.querySelector('.insight-no').textContent = index + 1;
    card.querySelector('h4').textContent = insight.title;
    card.querySelector('p').textContent = insight.text;
    card.querySelector('.insight-idea').textContent = `검토할 점: ${insight.idea}`;
    return card;
  }));
}

document.querySelectorAll('[data-go]').forEach((button) => {
  button.addEventListener('click', () => document.querySelector(`[data-view="${button.dataset.go}"]`)?.click());
});

function hasConfig() {
  return config && config.supabaseUrl?.startsWith('https://') && config.supabasePublishableKey;
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const darkMode = theme === 'dark';
  themeIcon.textContent = darkMode ? '☀️' : '🌙';
  const label = darkMode ? '라이트 모드로 전환' : '다크 모드로 전환';
  themeToggle.setAttribute('aria-label', label);
  themeToggle.title = label;
  localStorage.setItem('pharmacy-theme', theme);
}

const savedTheme = localStorage.getItem('pharmacy-theme');
applyTheme(savedTheme || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
themeToggle.addEventListener('click', () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'));

function renderProducts(keyword = '') {
  if (!selectedLedgerMonth) return;
  const monthStart = `${selectedLedgerMonth}-01`;
  const [year, month] = selectedLedgerMonth.split('-').map(Number);
  const nextMonth = `${year + (month === 12 ? 1 : 0)}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
  const movementsByProduct = new Map();
  inventoryMovements.forEach((movement) => {
    const date = movement.moved_at.slice(0, 10);
    const totals = movementsByProduct.get(movement.product_id) || { opening: 0, received: 0, issued: 0 };
    const quantity = Number(movement.quantity);
    if (date < monthStart) totals.opening += quantity;
    else if (date < nextMonth) {
      if (quantity > 0) totals.received += quantity;
      else totals.issued += Math.abs(quantity);
    }
    movementsByProduct.set(movement.product_id, totals);
  });
  const filtered = products.filter((product) => product.track_stock && matchesProduct(product, keyword));
  const overall = { opening: 0, received: 0, issued: 0, ending: 0 };
  productRows.replaceChildren(...filtered.map((product) => {
    const totals = movementsByProduct.get(product.id) || { opening: 0, received: 0, issued: 0 };
    const ending = totals.opening + totals.received - totals.issued;
    overall.opening += totals.opening;
    overall.received += totals.received;
    overall.issued += totals.issued;
    overall.ending += ending;
    const row = document.createElement('tr');
    const values = [
      product.code,
      product.name,
      product.product_costs?.[0]?.purchase_price === undefined ? '—' : `${Number(product.product_costs[0].purchase_price).toLocaleString('ko-KR')}원`,
      totals.opening.toLocaleString('ko-KR'),
      totals.received.toLocaleString('ko-KR'),
      totals.issued.toLocaleString('ko-KR'),
      ending.toLocaleString('ko-KR')
    ];
    values.forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
    return row;
  }));
  ledgerSummary.textContent = `${selectedLedgerMonth} · 기초 ${overall.opening.toLocaleString('ko-KR')}개 · 입고 ${overall.received.toLocaleString('ko-KR')}개 · 출고 ${overall.issued.toLocaleString('ko-KR')}개 · 재고 ${overall.ending.toLocaleString('ko-KR')}개`;
  ledgerSummary.hidden = false;
}

function prepareInventoryLedger() {
  const months = [...new Set(inventoryMovements.map((movement) => movement.moved_at.slice(0, 7)))].sort().reverse();
  selectedLedgerMonth = months.includes(selectedLedgerMonth) ? selectedLedgerMonth : months[0] || getLocalDate().slice(0, 7);
  ledgerMonth.replaceChildren(...months.map((month) => new Option(`${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`, month, false, month === selectedLedgerMonth)));
  ledgerMonth.disabled = months.length === 0;
  renderProducts(productSearch.value);
}

const legacySalesMonth = document.querySelector('#legacySalesMonth');
const legacySalesSearch = document.querySelector('#legacySalesSearch');
const legacySalesSummary = document.querySelector('#legacySalesSummary');
const legacySalesMonthSummary = document.querySelector('#legacySalesMonthSummary');
const legacySalesRows = document.querySelector('#legacySalesRows');
const legacySalesHead = document.querySelector('#legacySalesHead');
const legacySalesEmpty = document.querySelector('#legacySalesEmpty');
const legacySalesChart = document.querySelector('#legacySalesChart');
const legacySalesChartTitle = document.querySelector('#legacySalesChartTitle');
const legacySalesChartLegend = document.querySelector('#legacySalesChartLegend');
const legacySalesViewTabs = document.querySelector('#legacySalesViewTabs');
let legacySalesView = 'daily';
const weekdayLabel = ['일', '월', '화', '수', '목', '금', '토'];
// 2024~2026 대한민국 공휴일·명절(대체공휴일 포함). 매출 데이터 기간(2024-03~2026-10)만 다룸
const KOREA_HOLIDAYS = {
  '2024-03-01': '삼일절', '2024-05-05': '어린이날', '2024-05-06': '대체공휴일', '2024-05-15': '부처님오신날',
  '2024-06-06': '현충일', '2024-08-15': '광복절',
  '2024-09-16': '추석연휴', '2024-09-17': '추석', '2024-09-18': '추석연휴',
  '2024-10-03': '개천절', '2024-10-09': '한글날', '2024-12-25': '크리스마스',
  '2025-01-01': '신정', '2025-01-28': '설날연휴', '2025-01-29': '설날', '2025-01-30': '설날연휴',
  '2025-03-01': '삼일절', '2025-03-03': '대체공휴일',
  '2025-05-05': '어린이날·부처님오신날', '2025-05-06': '대체공휴일', '2025-06-06': '현충일', '2025-08-15': '광복절',
  '2025-10-03': '개천절', '2025-10-05': '추석연휴', '2025-10-06': '추석', '2025-10-07': '추석연휴',
  '2025-10-08': '대체공휴일', '2025-10-09': '한글날', '2025-12-25': '크리스마스',
  '2026-01-01': '신정', '2026-02-16': '설날연휴', '2026-02-17': '설날', '2026-02-18': '설날연휴',
  '2026-03-01': '삼일절', '2026-03-02': '대체공휴일', '2026-05-05': '어린이날', '2026-05-24': '부처님오신날',
  '2026-05-25': '대체공휴일', '2026-06-06': '현충일', '2026-08-15': '광복절', '2026-08-17': '대체공휴일',
  '2026-09-24': '추석연휴', '2026-09-25': '추석', '2026-09-26': '추석연휴', '2026-10-03': '개천절',
  '2026-10-05': '대체공휴일', '2026-10-09': '한글날', '2026-12-25': '크리스마스'
};
function dateMeta(dateText) {
  const day = new Date(`${dateText}T00:00:00`).getDay();
  const holiday = KOREA_HOLIDAYS[dateText];
  return { weekday: weekdayLabel[day], isWeekend: day === 0 || day === 6, holiday };
}

async function loadLegacySales() {
  try {
    legacySales = await apiAll('sales_legacy?select=sold_on,product_name_raw,quantity,unit_price,amount,margin_rate&order=sold_on.desc');
  } catch {
    legacySalesSummary.textContent = '매출 데이터를 불러오지 못했습니다.';
    return;
  }
  if (!legacySales.length) {
    legacySalesSummary.textContent = '등록된 매출 데이터가 없습니다.';
    return;
  }
  const dates = legacySales.map((row) => row.sold_on).sort();
  const totalAmount = legacySales.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  legacySalesSummary.textContent = `총 ${legacySales.length.toLocaleString('ko-KR')}건 · ${dates[0]} ~ ${dates.at(-1)} · 누적 매출액 ${won(totalAmount)}`;
  const months = [...new Set(legacySales.map((row) => row.sold_on.slice(0, 7)))].sort().reverse();
  selectedLegacySalesMonth = months.includes(selectedLegacySalesMonth) ? selectedLegacySalesMonth : months[0];
  legacySalesMonth.replaceChildren(...months.map((month) => new Option(`${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`, month, false, month === selectedLegacySalesMonth)));
  renderLegacySales();
}

function monthLabel(month) {
  return `${month.slice(0, 4)}년 ${Number(month.slice(5, 7))}월`;
}

function shiftMonth(month, offset) {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function setBarChart(items) {
  const max = Math.max(...items.map((d) => Math.abs(d.amount)), 1);
  legacySalesChart.replaceChildren(...items.map(({ label, amount, title, cls }) => {
    const item = document.createElement('div');
    item.className = `bar-item${cls ? ' ' + cls : ''}`;
    if (title) item.title = title;
    const bar = document.createElement('i');
    bar.style.height = `${Math.max((Math.abs(amount) / max) * 100, amount !== 0 ? 3 : 0)}%`;
    const value = document.createElement('span');
    value.className = 'bar-value';
    value.textContent = amount ? Math.round(amount / 1000).toLocaleString('ko-KR') : '';
    item.append(bar, value, document.createTextNode(label));
    return item;
  }));
}

const LEGACY_SALES_COL_WIDTH = {
  '일자': 95, '요일': 68, '수량': 72, '단가': 96, '금액': 110, '마진율': 76,
  '건수': 72, '비중': 68, '평균마진율': 94, '거래건수': 86, '전월대비': 86,
  '전년동월대비': 104, '건당 평균금액': 104, '매출액': 110,
  '예상기온': 90, '예상강수': 90, '공휴일': 90, '예측 매출액': 120,
};

function setTableHead(labels, wideIndex) {
  legacySalesHead.replaceChildren();
  const tr = document.createElement('tr');
  labels.forEach((label, i) => {
    const th = document.createElement('th');
    th.textContent = label;
    if (i === wideIndex) th.classList.add('col-wide');
    else th.style.width = `${LEGACY_SALES_COL_WIDTH[label] || 90}px`;
    tr.append(th);
  });
  legacySalesHead.append(tr);
}

function setRows(rowsData, wideIndex, totalCells) {
  legacySalesRows.replaceChildren();
  if (totalCells) {
    const totalTr = document.createElement('tr');
    totalTr.className = 'legacy-sales-total-row';
    totalCells.forEach((value) => { const td = document.createElement('td'); td.textContent = value; totalTr.append(td); });
    legacySalesRows.append(totalTr);
  }
  rowsData.forEach(({ cells, cls }) => {
    const tr = document.createElement('tr');
    if (cls) tr.className = cls;
    cells.forEach((value, i) => {
      const td = document.createElement('td');
      td.textContent = value;
      if (i === wideIndex) td.classList.add('col-wide');
      tr.append(td);
    });
    legacySalesRows.append(tr);
  });
}

function marginPct(row) {
  return row.margin_rate == null ? null : Number(row.margin_rate) * 100;
}

function renderDailyView(rows) {
  const byDay = new Map();
  rows.forEach((row) => byDay.set(row.sold_on, (byDay.get(row.sold_on) || 0) + Number(row.amount || 0)));
  const [year, month] = selectedLegacySalesMonth.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayAmounts = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateText = `${selectedLegacySalesMonth}-${String(day).padStart(2, '0')}`;
    dayAmounts.push({ day, dateText, amount: byDay.get(dateText) || 0, meta: dateMeta(dateText) });
  }
  setBarChart(dayAmounts.map(({ day, dateText, amount, meta }) => ({
    label: String(day), amount,
    cls: meta.holiday ? 'holiday' : meta.isWeekend ? 'weekend' : '',
    title: `${dateText} (${meta.weekday})${meta.holiday ? ' · ' + meta.holiday : ''} · ${won(amount)}`,
  })));
  setTableHead(['일자', '요일', '상품명', '수량', '단가', '금액', '마진율'], 2);
  if (!rows.length) { setRows([], 2, null); return; }
  const totalAmount = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const totalQty = rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0);
  setRows(rows.map((row) => {
    const meta = dateMeta(row.sold_on);
    const weekdayText = meta.holiday ? `${meta.weekday} · ${meta.holiday}` : meta.weekday;
    return {
      cls: meta.holiday ? 'is-holiday' : meta.isWeekend ? 'is-weekend' : '',
      cells: [row.sold_on, weekdayText, row.product_name_raw, row.quantity, won(row.unit_price), won(row.amount), row.margin_rate == null ? '—' : `${marginPct(row).toFixed(1)}%`],
    };
  }), 2, ['합계', '', `${rows.length.toLocaleString('ko-KR')}건`, totalQty.toLocaleString('ko-KR'), '—', won(totalAmount), '—']);
}

function renderProductView(rows) {
  const byProduct = new Map();
  rows.forEach((row) => {
    const key = row.product_name_raw;
    const entry = byProduct.get(key) || { name: key, qty: 0, amount: 0, marginSum: 0, marginCount: 0, count: 0 };
    entry.qty += Number(row.quantity || 0);
    entry.amount += Number(row.amount || 0);
    entry.count += 1;
    if (row.margin_rate != null) { entry.marginSum += Number(row.margin_rate); entry.marginCount += 1; }
    byProduct.set(key, entry);
  });
  const list = [...byProduct.values()].sort((a, b) => b.amount - a.amount);
  const totalAmount = list.reduce((sum, e) => sum + e.amount, 0);
  setBarChart(list.slice(0, 12).map((e) => ({ label: e.name.length > 6 ? e.name.slice(0, 5) + '…' : e.name, amount: e.amount, title: `${e.name} · ${won(e.amount)}` })));
  setTableHead(['상품명', '건수', '수량', '매출액', '비중', '평균마진율'], 0);
  if (!list.length) { setRows([], 0, null); return; }
  const totalQty = list.reduce((sum, e) => sum + e.qty, 0);
  setRows(list.map((e) => ({
    cells: [e.name, `${e.count.toLocaleString('ko-KR')}건`, e.qty.toLocaleString('ko-KR'), won(e.amount), `${((e.amount / totalAmount) * 100).toFixed(1)}%`, e.marginCount ? `${((e.marginSum / e.marginCount) * 100).toFixed(1)}%` : '—'],
  })), 0, ['합계', `${rows.length.toLocaleString('ko-KR')}건`, totalQty.toLocaleString('ko-KR'), won(totalAmount), '100%', '—']);
}

function renderWeekdayView(rows) {
  const buckets = weekdayLabel.map((label, idx) => ({ idx, label, amount: 0, qty: 0, count: 0 }));
  rows.forEach((row) => {
    const idx = new Date(`${row.sold_on}T00:00:00`).getDay();
    buckets[idx].amount += Number(row.amount || 0);
    buckets[idx].qty += Number(row.quantity || 0);
    buckets[idx].count += 1;
  });
  setBarChart(buckets.map((b) => ({ label: b.label, amount: b.amount, cls: b.idx === 0 || b.idx === 6 ? 'weekend' : '', title: `${b.label}요일 · ${won(b.amount)}` })));
  setTableHead(['요일', '거래건수', '수량', '매출액', '건당 평균금액'], -1);
  const totalAmount = buckets.reduce((sum, b) => sum + b.amount, 0);
  const totalQty = buckets.reduce((sum, b) => sum + b.qty, 0);
  const totalCount = buckets.reduce((sum, b) => sum + b.count, 0);
  setRows(buckets.map((b) => ({
    cls: b.idx === 0 || b.idx === 6 ? 'is-weekend' : '',
    cells: [`${b.label}요일`, `${b.count.toLocaleString('ko-KR')}건`, b.qty.toLocaleString('ko-KR'), won(b.amount), b.count ? won(Math.round(b.amount / b.count)) : '—'],
  })), -1, ['합계', `${totalCount.toLocaleString('ko-KR')}건`, totalQty.toLocaleString('ko-KR'), won(totalAmount), totalCount ? won(Math.round(totalAmount / totalCount)) : '—']);
}

function renderMarginView(rows) {
  const byProduct = new Map();
  rows.forEach((row) => {
    if (row.margin_rate == null) return;
    const key = row.product_name_raw;
    const entry = byProduct.get(key) || { name: key, amount: 0, marginSum: 0, marginCount: 0 };
    entry.amount += Number(row.amount || 0);
    entry.marginSum += Number(row.margin_rate);
    entry.marginCount += 1;
    byProduct.set(key, entry);
  });
  const list = [...byProduct.values()].map((e) => ({ ...e, avgMargin: (e.marginSum / e.marginCount) * 100 })).sort((a, b) => a.avgMargin - b.avgMargin);
  setBarChart(list.slice(0, 12).map((e) => ({ label: e.name.length > 6 ? e.name.slice(0, 5) + '…' : e.name, amount: e.avgMargin, cls: e.avgMargin < 15 ? 'holiday' : e.avgMargin < 25 ? 'weekend' : '', title: `${e.name} · 평균마진율 ${e.avgMargin.toFixed(1)}%` })));
  setTableHead(['상품명', '매출액', '평균마진율'], 0);
  if (!list.length) { setRows([], 0, null); return; }
  const totalAmount = list.reduce((sum, e) => sum + e.amount, 0);
  const weightedMargin = list.reduce((sum, e) => sum + e.avgMargin * e.amount, 0) / (totalAmount || 1);
  setRows(list.map((e) => ({
    cls: e.avgMargin < 15 ? 'is-holiday' : '',
    cells: [e.name, won(e.amount), `${e.avgMargin.toFixed(1)}%`],
  })), 0, ['합계(매출 가중평균)', won(totalAmount), `${weightedMargin.toFixed(1)}%`]);
}

function monthTotals(month) {
  const rows = legacySales.filter((row) => row.sold_on.startsWith(month));
  return { month, amount: rows.reduce((sum, row) => sum + Number(row.amount || 0), 0), qty: rows.reduce((sum, row) => sum + Number(row.quantity || 0), 0), count: rows.length };
}

function renderRecent3mView() {
  const months = [shiftMonth(selectedLegacySalesMonth, -2), shiftMonth(selectedLegacySalesMonth, -1), selectedLegacySalesMonth];
  const totals = months.map(monthTotals);
  setBarChart(totals.map((t) => ({ label: monthLabel(t.month).replace('년 ', '.').replace('월', ''), amount: t.amount, title: `${monthLabel(t.month)} · ${won(t.amount)}` })));
  setTableHead(['월', '거래건수', '수량', '매출액', '전월대비'], -1);
  setRows(totals.map((t, i) => {
    const prev = i > 0 ? totals[i - 1].amount : null;
    const diff = prev != null && prev > 0 ? ((t.amount - prev) / prev) * 100 : null;
    return { cls: diff != null && diff > 0 ? 'is-diff-up' : diff != null && diff < 0 ? 'is-diff-down' : '', cells: [monthLabel(t.month), `${t.count.toLocaleString('ko-KR')}건`, t.qty.toLocaleString('ko-KR'), won(t.amount), diff == null ? '—' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`] };
  }), -1, null);
}

function renderYoyView() {
  const thisMonth = monthTotals(selectedLegacySalesMonth);
  const lastYear = monthTotals(shiftMonth(selectedLegacySalesMonth, -12));
  setBarChart([
    { label: monthLabel(lastYear.month), amount: lastYear.amount, title: `${monthLabel(lastYear.month)} · ${won(lastYear.amount)}` },
    { label: monthLabel(thisMonth.month), amount: thisMonth.amount, title: `${monthLabel(thisMonth.month)} · ${won(thisMonth.amount)}` },
  ]);
  setTableHead(['월', '거래건수', '수량', '매출액', '전년동월대비'], -1);
  const diff = lastYear.amount > 0 ? ((thisMonth.amount - lastYear.amount) / lastYear.amount) * 100 : null;
  setRows([
    { cells: [monthLabel(lastYear.month), `${lastYear.count.toLocaleString('ko-KR')}건`, lastYear.qty.toLocaleString('ko-KR'), won(lastYear.amount), '—'] },
    { cls: diff != null && diff > 0 ? 'is-diff-up' : diff != null && diff < 0 ? 'is-diff-down' : '', cells: [monthLabel(thisMonth.month), `${thisMonth.count.toLocaleString('ko-KR')}건`, thisMonth.qty.toLocaleString('ko-KR'), won(thisMonth.amount), diff == null ? '데이터 없음' : `${diff > 0 ? '+' : ''}${diff.toFixed(1)}%`] },
  ], -1, null);
}

// ---------- 날씨·생활인구 상관분석 및 향후 2주 매출 예측 ----------
let environmentalWeather = [];
let dongPopulationDaily = [];
let weatherPopLoaded = false;
let weatherPopLoading = false;
let weatherForecastCache = null;
let weatherForecastLoading = false;
let weatherModelCache = null;

async function ensureWeatherPopData() {
  if (weatherPopLoaded || weatherPopLoading) return;
  weatherPopLoading = true;
  try {
    [environmentalWeather, dongPopulationDaily] = await Promise.all([
      apiAll('environmental_data?select=date,temp_mean,precipitation_mm,humidity_mean&order=date.asc'),
      apiAll('dong_population_daily?select=measured_on,avg_population,business_hours_avg&order=measured_on.asc'),
    ]);
  } catch {
    environmentalWeather = []; dongPopulationDaily = [];
  }
  weatherPopLoaded = true;
  weatherPopLoading = false;
}

async function fetchForecastWeather() {
  const query = new URLSearchParams({
    latitude: '37.5486', longitude: '127.1248', timezone: 'Asia/Seoul', forecast_days: '14',
    daily: 'temperature_2m_mean,precipitation_sum',
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
  if (!response.ok) throw new Error('예보를 불러오지 못했습니다.');
  const { daily } = await response.json();
  return daily.time.map((date, i) => ({ date, temp: daily.temperature_2m_mean[i], precip: daily.precipitation_sum[i] }));
}

async function ensureForecastWeather() {
  if (weatherForecastCache || weatherForecastLoading) return;
  weatherForecastLoading = true;
  try { weatherForecastCache = await fetchForecastWeather(); } catch { weatherForecastCache = []; }
  weatherForecastLoading = false;
}

function dot(a, b) { return a.reduce((sum, v, i) => sum + v * b[i], 0); }

function pearson(xs, ys) {
  const n = xs.length;
  if (n < 2) return null;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? null : num / denom;
}

// 가우스-조던 소거법으로 (XtX)beta = Xty 를 풀어 다중선형회귀 계수를 구한다
function solveLinear(A, b) {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (Math.abs(M[pivot][col]) < 1e-9) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const pv = M[col][col];
    for (let c = col; c <= n; c += 1) M[col][c] /= pv;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = M[r][col];
      for (let c = col; c <= n; c += 1) M[r][c] -= factor * M[col][c];
    }
  }
  return M.map((row) => row[n]);
}

function fitOLS(X, y) {
  const n = X.length, k = X[0].length;
  const XtX = Array.from({ length: k }, () => new Array(k).fill(0));
  const Xty = new Array(k).fill(0);
  for (let i = 0; i < n; i += 1) {
    for (let a = 0; a < k; a += 1) {
      Xty[a] += X[i][a] * y[i];
      for (let b = 0; b < k; b += 1) XtX[a][b] += X[i][a] * X[i][b];
    }
  }
  return solveLinear(XtX, Xty);
}

// 요일·명절·기온·강수·추세(날짜 순번)로 일별 매출을 설명하는 경량 회귀 모델.
// 생활인구는 과거 약 6개월치만 있어 예측에는 못 쓰고, 참고용 상관계수만 별도로 낸다.
function buildWeatherModel() {
  if (weatherModelCache) return weatherModelCache;
  if (!legacySales.length || !environmentalWeather.length) return null;
  const salesByDate = new Map();
  legacySales.forEach((row) => salesByDate.set(row.sold_on, (salesByDate.get(row.sold_on) || 0) + Number(row.amount || 0)));
  const weatherByDate = new Map(environmentalWeather.map((w) => [w.date, w]));
  const salesDates = [...salesByDate.keys()].sort();
  const minDateObj = new Date(`${salesDates[0]}T00:00:00`);
  const maxDateObj = new Date(`${salesDates.at(-1)}T00:00:00`);
  const days = [];
  for (let d = new Date(minDateObj); d <= maxDateObj; d.setDate(d.getDate() + 1)) {
    const dateText = d.toISOString().slice(0, 10);
    const w = weatherByDate.get(dateText);
    if (!w || w.temp_mean == null) continue;
    const meta = dateMeta(dateText);
    days.push({
      date: dateText,
      amount: salesByDate.get(dateText) || 0,
      temp: Number(w.temp_mean),
      precip: Number(w.precipitation_mm || 0),
      isWeekend: meta.isWeekend ? 1 : 0,
      isHoliday: meta.holiday ? 1 : 0,
      trend: Math.round((d - minDateObj) / 86400000),
    });
  }
  if (days.length < 30) return null;
  const X = days.map((d) => [1, d.isWeekend, d.isHoliday, d.temp, d.precip, d.trend]);
  const y = days.map((d) => d.amount);
  const beta = fitOLS(X, y);
  if (!beta) return null;
  const predicted = X.map((row) => dot(row, beta));
  const meanY = y.reduce((a, b) => a + b, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - meanY) ** 2, 0);
  const ssRes = y.reduce((s, v, i) => s + (v - predicted[i]) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : null;
  const pearsonTemp = pearson(days.map((d) => d.temp), y);
  const pearsonPrecip = pearson(days.map((d) => d.precip), y);
  const popByDate = new Map(dongPopulationDaily.map((p) => [p.measured_on, Number(p.business_hours_avg)]));
  const popPairs = days.filter((d) => popByDate.has(d.date)).map((d) => ({ pop: popByDate.get(d.date), amount: d.amount }));
  const pearsonPop = popPairs.length >= 10 ? pearson(popPairs.map((p) => p.pop), popPairs.map((p) => p.amount)) : null;
  weatherModelCache = { beta, days, r2, pearsonTemp, pearsonPrecip, pearsonPop, popN: popPairs.length, minDateObj };
  return weatherModelCache;
}

function renderWeatherView() {
  if (!weatherPopLoaded || !weatherForecastCache) {
    setBarChart([]);
    setTableHead(['안내'], 0);
    setRows([{ cells: ['날씨·생활인구 데이터와 예보를 불러오는 중입니다...'] }], 0, null);
    legacySalesMonthSummary.hidden = true;
    ensureWeatherPopData().then(() => ensureForecastWeather()).then(() => {
      if (legacySalesView === 'weather') renderLegacySales();
    });
    return;
  }
  const model = buildWeatherModel();
  if (!model) {
    setBarChart([]);
    setTableHead(['안내'], 0);
    setRows([{ cells: ['학습에 쓸 수 있는 매출·날씨 데이터가 30일 이상 겹치지 않습니다.'] }], 0, null);
    legacySalesMonthSummary.hidden = true;
    return;
  }
  const forecast = weatherForecastCache.map((f) => {
    const meta = dateMeta(f.date);
    const trend = Math.round((new Date(`${f.date}T00:00:00`) - model.minDateObj) / 86400000);
    const feat = [1, meta.isWeekend ? 1 : 0, meta.holiday ? 1 : 0, Number(f.temp), Number(f.precip), trend];
    return { date: f.date, meta, temp: Number(f.temp), precip: Number(f.precip), predicted: Math.max(0, dot(feat, model.beta)) };
  });
  setBarChart(forecast.map((f) => ({
    label: String(Number(f.date.slice(8, 10))), amount: f.predicted,
    cls: f.meta.holiday ? 'holiday' : f.meta.isWeekend ? 'weekend' : '',
    title: `${f.date} (${f.meta.weekday})${f.meta.holiday ? ' · ' + f.meta.holiday : ''} · 예측 ${won(f.predicted)} · ${f.temp.toFixed(1)}°C · 강수 ${f.precip.toFixed(1)}mm`,
  })));
  setTableHead(['일자', '요일', '예상기온', '예상강수', '공휴일', '예측 매출액'], -1);
  setRows(forecast.map((f) => ({
    cls: f.meta.holiday ? 'is-holiday' : f.meta.isWeekend ? 'is-weekend' : '',
    cells: [f.date, f.meta.weekday, `${f.temp.toFixed(1)}°C`, `${f.precip.toFixed(1)}mm`, f.meta.holiday || '—', won(f.predicted)],
  })), -1, null);
  legacySalesMonthSummary.hidden = false;
  const r2Text = model.r2 == null ? 'R² 산출 불가' : `설명력 R²=${model.r2.toFixed(2)}`;
  const tempText = model.pearsonTemp == null ? '' : ` · 기온 상관 r=${model.pearsonTemp.toFixed(2)}`;
  const precipText = model.pearsonPrecip == null ? '' : ` · 강수 상관 r=${model.pearsonPrecip.toFixed(2)}`;
  const popText = model.pearsonPop == null ? ' · 생활인구 상관: 겹치는 기간 부족' : ` · 생활인구 상관 r=${model.pearsonPop.toFixed(2)} (겹치는 ${model.popN}일 기준, 예측에는 미반영)`;
  legacySalesMonthSummary.textContent = `학습 데이터 ${model.days.length}일(요일·명절·기온·강수 기반 회귀) · ${r2Text}${tempText}${precipText}${popText}`;
}

const legacySalesViewConfig = {
  daily: { title: '일별 매출 추이', legend: true },
  product: { title: '상품별 매출 비중 (상위 12)', legend: false },
  weekday: { title: '요일별 매출 패턴', legend: false },
  margin: { title: '상품별 평균 마진율 (낮은 순, 상위 12)', legend: false },
  recent3m: { title: '최근 3개월 매출 비교', legend: false },
  yoy: { title: '전년 동기 매출 비교', legend: false },
  weather: { title: '날씨·생활인구 기반 향후 14일 매출 예측', legend: false },
};

function renderLegacySales() {
  const keyword = legacySalesSearch.value.trim().toLowerCase();
  const monthRows = legacySales.filter((row) => row.sold_on.startsWith(selectedLegacySalesMonth));
  const filteredRows = monthRows.filter((row) => !keyword || row.product_name_raw.toLowerCase().includes(keyword));
  const config = legacySalesViewConfig[legacySalesView];
  legacySalesChartTitle.firstChild.textContent = config.title + ' ';
  legacySalesChartLegend.hidden = !config.legend;

  if (!filteredRows.length && legacySalesView !== 'recent3m' && legacySalesView !== 'yoy' && legacySalesView !== 'weather') {
    legacySalesMonthSummary.hidden = true;
    setBarChart([]);
    legacySalesRows.replaceChildren();
    legacySalesEmpty.hidden = false;
    return;
  }
  legacySalesEmpty.hidden = true;
  const totalAmount = filteredRows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  legacySalesMonthSummary.hidden = false;
  legacySalesMonthSummary.textContent = `${selectedLegacySalesMonth} · ${filteredRows.length.toLocaleString('ko-KR')}건 · 매출액 ${won(totalAmount)}`;

  if (legacySalesView === 'product') renderProductView(filteredRows);
  else if (legacySalesView === 'weekday') renderWeekdayView(filteredRows);
  else if (legacySalesView === 'margin') renderMarginView(filteredRows);
  else if (legacySalesView === 'recent3m') renderRecent3mView();
  else if (legacySalesView === 'yoy') renderYoyView();
  else if (legacySalesView === 'weather') renderWeatherView();
  else renderDailyView(filteredRows);
}

legacySalesMonth.addEventListener('change', () => { selectedLegacySalesMonth = legacySalesMonth.value; renderLegacySales(); });
legacySalesSearch.addEventListener('input', renderLegacySales);
legacySalesViewTabs.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-view]');
  if (!button) return;
  legacySalesView = button.dataset.view;
  legacySalesViewTabs.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b === button));
  renderLegacySales();
});

async function loadInventoryMovements() {
  const pageSize = 1000;
  let start = 0;
  const rows = [];
  while (true) {
    const response = await api('inventory_movements?select=product_id,moved_at,quantity&order=moved_at.asc', {
      headers: { Range: `${start}-${start + pageSize - 1}`, 'Range-Unit': 'items' }
    });
    if (!response.ok) throw new Error('재고 이동 기록을 불러오지 못했습니다.');
    const page = await response.json();
    rows.push(...page);
    if (page.length < pageSize) break;
    start += pageSize;
  }
  inventoryMovements = rows;
}

function getKoreanInitials(value = '') {
  const initials = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
  return [...value].map((character) => {
    const offset = character.charCodeAt(0) - 0xac00;
    return offset >= 0 && offset < 11172 ? initials[Math.floor(offset / 588)] : character;
  }).join('');
}

function matchesProduct(product, keyword = '') {
  const query = keyword.trim().toLowerCase().replaceAll(' ', '');
  if (!query) return true;
  const searchable = `${product.name} ${product.code}`.toLowerCase().replaceAll(' ', '');
  const initials = getKoreanInitials(product.name).replaceAll(' ', '');
  return searchable.includes(query) || (/^[ㄱ-ㅎ]+$/.test(query) && initials.includes(query));
}

function getRecentProducts() {
  try {
    const recentCodes = JSON.parse(localStorage.getItem(recentProductStorageKey) || '[]');
    return recentCodes.map((code) => products.find((product) => product.code === code)).filter(Boolean);
  } catch {
    return [];
  }
}

function rememberProduct(product) {
  const codes = [product.code, ...getRecentProducts().map((item) => item.code)].filter((code, index, list) => list.indexOf(code) === index).slice(0, 6);
  localStorage.setItem(recentProductStorageKey, JSON.stringify(codes));
}

function getSuggestedProducts(keyword = '') {
  const query = keyword.trim();
  if (!query) {
    const recent = getRecentProducts();
    const recentCodes = new Set(recent.map((product) => product.code));
    return [...recent, ...products.filter((product) => !recentCodes.has(product.code))].slice(0, 8);
  }
  return products.filter((product) => matchesProduct(product, query)).slice(0, 8);
}

function closeProductSuggestions() {
  activeSuggestionIndex = -1;
  saleProductSuggestions.hidden = true;
  saleProductSearch.setAttribute('aria-expanded', 'false');
  saleProductSearch.removeAttribute('aria-activedescendant');
}

function selectSaleProduct(product) {
  saleProductValue.value = product.code;
  saleProductSearch.value = product.name;
  saleProductHint.textContent = `${product.code} · ${Number(product.sale_price).toLocaleString('ko-KR')}원 · 현재 재고 ${product.product_stock?.[0]?.quantity ?? '—'}개`;
  closeProductSuggestions();
  document.querySelector('#saleQuantity').focus();
  document.querySelector('#saleQuantity').select();
}

function renderProductSuggestions(keyword = '') {
  const suggested = getSuggestedProducts(keyword);
  activeSuggestionIndex = -1;
  saleProductSuggestions.replaceChildren();
  saleProductSearch.setAttribute('aria-expanded', 'true');

  if (!suggested.length) {
    const empty = document.createElement('p');
    empty.className = 'suggestion-empty';
    empty.textContent = '일치하는 상품이 없습니다. 상품명, 코드 또는 초성을 다시 입력하세요.';
    saleProductSuggestions.append(empty);
    saleProductSuggestions.hidden = false;
    return;
  }

  suggested.forEach((product, index) => {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'product-suggestion';
    option.id = `sale-product-option-${index}`;
    option.setAttribute('role', 'option');
    option.innerHTML = '<span><b></b><small></small></span><em></em>';
    option.querySelector('b').textContent = product.name;
    option.querySelector('small').textContent = `${product.code} · 재고 ${product.product_stock?.[0]?.quantity ?? '—'}개`;
    option.querySelector('em').textContent = `${Number(product.sale_price).toLocaleString('ko-KR')}원`;
    option.addEventListener('mousedown', (event) => event.preventDefault());
    option.addEventListener('click', () => selectSaleProduct(product));
    saleProductSuggestions.append(option);
  });
  saleProductSuggestions.hidden = false;
  saleProductHint.textContent = keyword.trim() ? `${suggested.length}개 상품을 찾았습니다. ↑↓와 Enter로도 선택할 수 있습니다.` : '최근 선택 상품과 추천 상품입니다. 상품명·코드·초성으로 찾을 수 있습니다.';
}

function moveSuggestion(step) {
  const options = [...saleProductSuggestions.querySelectorAll('.product-suggestion')];
  if (!options.length) return;
  activeSuggestionIndex = (activeSuggestionIndex + step + options.length) % options.length;
  options.forEach((option, index) => option.classList.toggle('active', index === activeSuggestionIndex));
  const activeOption = options[activeSuggestionIndex];
  saleProductSearch.setAttribute('aria-activedescendant', activeOption.id);
  activeOption.scrollIntoView({ block: 'nearest' });
}

function setDashboardValue(index, value, detail) {
  const cards = document.querySelectorAll('.summary-card');
  if (!cards[index]) return;
  cards[index].querySelector('strong').textContent = value;
  cards[index].querySelector('span').textContent = detail;
}

function formatWeatherDate(value) {
  const [year, month, day] = value.split('-').map(Number);
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  return `${month}/${day} (${weekdays[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]})`;
}

function weatherIcon(weatherCode, precipitation) {
  if (Number(precipitation) > 0 || [51, 53, 55, 61, 63, 65, 80, 81, 82].includes(Number(weatherCode))) return '🌧️';
  if ([71, 73, 75, 77, 85, 86].includes(Number(weatherCode))) return '❄️';
  if (weatherCode === undefined || weatherCode === null) return '🌤️';
  if (Number(weatherCode) <= 1) return '☀️';
  if (Number(weatherCode) <= 3) return '⛅';
  return '☁️';
}

async function loadSeoulForecast() {
  const query = new URLSearchParams({
    latitude: '37.5665', longitude: '126.9780', timezone: 'Asia/Seoul', forecast_days: '7',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max'
  });
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${query}`);
  if (!response.ok) throw new Error('서울 날씨 예보를 불러오지 못했습니다.');
  const { daily } = await response.json();
  if (!daily?.time) throw new Error('서울 날씨 예보 형식이 올바르지 않습니다.');
  return daily.time.map((date, index) => ({
    date,
    weatherCode: daily.weather_code[index],
    tempMax: daily.temperature_2m_max[index],
    tempMin: daily.temperature_2m_min[index],
    precipitation: daily.precipitation_sum[index],
    precipitationProbability: daily.precipitation_probability_max[index]
  }));
}

function buildWeatherEstimate(sales, saleItems, weather, forecast) {
  if (!forecast?.length) return [];
  const saleDates = new Map(sales.map((sale) => [sale.id, sale.sold_at.slice(0, 10)]));
  const categoryByProduct = new Map(products.map((product) => [product.id, product.product_categories?.name || '기타']));
  const dailyUnits = new Map();
  saleItems.forEach((item) => {
    const date = saleDates.get(item.sale_id);
    const category = categoryByProduct.get(item.product_id) || '기타';
    if (!date) return;
    const day = dailyUnits.get(date) || {};
    day[category] = (day[category] || 0) + Number(item.quantity);
    dailyUnits.set(date, day);
  });

  const signals = [
    { key: 'hot', forecastDays: forecast.filter((day) => Number(day.tempMax) >= 28), condition: (day) => Number(day.temp_max) >= 28, categories: ['외부 기생충 예방약', '내·외부 기생충 예방약', '심장사상충 예방약'], label: '고온' },
    { key: 'rain', forecastDays: forecast.filter((day) => Number(day.precipitation) >= 15), condition: (day) => Number(day.precipitation_mm) >= 15, categories: ['약용 샴푸', '피부 외용제'], label: '강한 비' }
  ];

  return signals.map((signal) => {
    if (!signal.forecastDays.length) return null;
    const matchingDays = weather.filter((day) => signal.condition(day));
    const otherDays = weather.filter((day) => !signal.condition(day));
    const unitsForDay = (date) => Object.entries(dailyUnits.get(date) || {})
      .filter(([category]) => signal.categories.includes(category))
      .reduce((sum, [, quantity]) => sum + quantity, 0);
    const average = (days) => days.length ? days.reduce((sum, day) => sum + unitsForDay(day.date), 0) / days.length : 0;
    const extraPerDay = Math.max(0, average(matchingDays) - average(otherDays));
    const estimatedUnits = Math.round(extraPerDay * signal.forecastDays.length);
    return { ...signal, estimatedUnits, evidenceDays: matchingDays.length };
  }).filter(Boolean);
}

function buildWeatherOutlook(sales, saleItems, weather, forecast, errorMessage = '') {
  const history = [...weather].filter((day) => day.temp_max !== null && day.temp_max !== undefined).sort((a, b) => a.date.localeCompare(b.date)).slice(-7);
  const estimates = buildWeatherEstimate(sales, saleItems, weather, forecast);
  const historyCards = history.map((day) => `<article class="weather-day observed"><span class="weather-icon">${weatherIcon(null, day.precipitation_mm)}</span><strong>${formatWeatherDate(day.date)}</strong><span>${Number(day.temp_min).toFixed(0)}° / ${Number(day.temp_max).toFixed(0)}°</span><small>${Number(day.precipitation_mm) > 0 ? `비 ${Number(day.precipitation_mm).toFixed(1)}mm` : '강수 없음'}</small></article>`).join('') || '<p class="weather-empty">표시할 실제 날씨 기록이 없습니다.</p>';
  const forecastCards = forecast === null
    ? '<p class="weather-empty">서울 예보를 불러오는 중입니다.</p>'
    : forecast?.length
      ? forecast.map((day) => `<article class="weather-day forecast"><span class="weather-icon">${weatherIcon(day.weatherCode, day.precipitation)}</span><strong>${formatWeatherDate(day.date)}</strong><span>${Number(day.tempMin).toFixed(0)}° / ${Number(day.tempMax).toFixed(0)}°</span><small>${Number(day.precipitation) > 0 ? `비 ${Number(day.precipitation).toFixed(1)}mm` : '강수 없음'}${day.precipitationProbability ? ` · ${day.precipitationProbability}%` : ''}</small></article>`).join('')
      : `<p class="weather-empty">${errorMessage || '서울 예보를 표시할 수 없습니다.'}</p>`;
  const estimateText = estimates.length
    ? estimates.map((signal) => `<li><b>${signal.label} ${signal.forecastDays.length}일</b> · ${signal.categories.join('·')} 예상 추가 수요 ${signal.estimatedUnits.toLocaleString('ko-KR')}개 <span>(과거 유사 날씨 ${signal.evidenceDays}일 비교)</span></li>`).join('')
    : '<li>향후 7일에는 고온(28℃ 이상) 또는 강한 비(15mm 이상) 기준의 추가 수요 신호가 없습니다.</li>';

  return `<section class="weather-outlook" aria-labelledby="weatherOutlookTitle"><div class="weather-outlook-heading"><div><p class="eyebrow">SEOUL WEATHER & DEMAND</p><h3 id="weatherOutlookTitle">날씨와 수요 참고</h3><p>서울 기준 · 실제 기록 7일과 향후 7일 예보를 비교합니다.</p></div><span>예보: Open-Meteo</span></div><div class="weather-columns"><section><h4>최근 기록 7일</h4><div class="weather-days">${historyCards}</div></section><section><h4>향후 예보 7일</h4><div class="weather-days">${forecastCards}</div></section></div><div class="weather-estimate"><strong>날씨 기반 추정</strong><ul>${estimateText}</ul><p>참고용 규칙 기반 추정이며, 발주·재고 결정은 실제 판매 및 재고와 함께 확인하세요.</p></div></section>`;
}

// 판매량이 너무 적은 분류는 %가 크게 부풀려지므로, 이 기준 미만이면 증감률을 계산하지 않음
const MIN_BASELINE_WEEKLY_UNITS = 3; // 평소(직전 4주) 주간 판매량 최소 기준
const MIN_SEASON_WEEK_UNITS = 5;     // 성수기 1주 판매량 최소 기준
const MIN_COMPARE_UNITS = 3;
const MIN_COMPARE_AMOUNT = 100000;  // 분류별 전년 비교 시 전년 매출액(원) 최소 기준         // 전년 동일 주 비교 시 전년 판매량 최소 기준

function buildSeasonalAlerts(sales, saleItems, weather) {
  const settings = getSeasonalitySettings();
  const completedSales = sales.filter((sale) => sale.status === 'completed');
  const latestDate = completedSales.map((sale) => sale.sold_at.slice(0, 10)).sort().at(-1);
  if (!latestDate) return { alerts: [], latestDate: '', settings, hasComparison: false };

  const salesById = new Map(completedSales.map((sale) => [sale.id, sale.sold_at.slice(0, 10)]));
  const categoryForProduct = new Map(products.map((product) => [product.id, product.product_categories?.name || '기타']));
  const rows = saleItems.map((item) => ({
    date: salesById.get(item.sale_id),
    category: categoryForProduct.get(item.product_id) || '기타',
    quantity: Number(item.quantity),
    productId: item.product_id
  })).filter((item) => item.date);
  const categories = [...new Set(rows.map((item) => item.category))];
  const priorAnchor = sameDayPreviousYear(latestDate);
  const weatherByDate = new Map(weather.map((item) => [item.date, item]));
  const currentWeather = weatherByDate.get(latestDate);
  const alerts = [];

  function categoryUnits(category, start, end) {
    return rows.reduce((sum, item) => sum + (item.category === category && item.date >= start && item.date <= end ? item.quantity : 0), 0);
  }

  categories.forEach((category) => {
    const candidateWeeks = Array.from({ length: 8 }, (_, index) => {
      const start = addDays(priorAnchor, settings.leadDays + index);
      const units = categoryUnits(category, start, addDays(start, 6));
      const baseline = categoryUnits(category, addDays(start, -28), addDays(start, -1)) / 4;
      return { start, units, baseline, increaseRate: baseline ? ((units - baseline) / baseline) * 100 : null };
    }).filter((candidate) => candidate.baseline >= MIN_BASELINE_WEEKLY_UNITS && candidate.units >= MIN_SEASON_WEEK_UNITS && candidate.increaseRate >= settings.threshold)
      .sort((a, b) => b.increaseRate - a.increaseRate);
    const bestCandidate = candidateWeeks[0];
    if (!bestCandidate) return;
    const lastYearStart = bestCandidate.start;
    const seasonUnits = bestCandidate.units;
    const baselineUnits = bestCandidate.baseline;

    const currentRecent = categoryUnits(category, addDays(latestDate, -13), latestDate);
    const currentPrevious = categoryUnits(category, addDays(latestDate, -27), addDays(latestDate, -14));
    const currentFourWeek = categoryUnits(category, addDays(latestDate, -27), latestDate);
    const currentChange = currentPrevious ? ((currentRecent - currentPrevious) / currentPrevious) * 100 : null;
    const currentDailyAverage = currentRecent / 14;
    const stock = products.filter((product) => categoryForProduct.get(product.id) === category && product.track_stock)
      .reduce((sum, product) => sum + Number(product.product_stock?.[0]?.quantity || 0), 0);
    const stockDays = currentDailyAverage > 0 ? Math.floor(stock / currentDailyAverage) : null;
    const lastYearWeather = weatherByDate.get(lastYearStart);
    const temperatureDifference = currentWeather && lastYearWeather ? Math.abs(Number(currentWeather.temp_mean) - Number(lastYearWeather.temp_mean)) : null;
    const similarWeather = temperatureDifference !== null && temperatureDifference <= 5;
    const risingNow = currentChange === null ? currentRecent > 0 : currentChange > 0;

    const increaseRate = ((seasonUnits - baselineUnits) / baselineUnits) * 100;
    alerts.push({
      category, lastYearStart, seasonUnits, baselineUnits, increaseRate, currentChange, currentFourWeek, stock, stockDays,
      weatherText: lastYearWeather && currentWeather
        ? `작년 ${Number(lastYearWeather.temp_mean).toFixed(1)}°C/${Number(lastYearWeather.precipitation_mm || 0).toFixed(1)}mm · 최근 ${Number(currentWeather.temp_mean).toFixed(1)}°C/${Number(currentWeather.precipitation_mm || 0).toFixed(1)}mm`
        : '비교 가능한 날씨 기록이 부족합니다.',
      similarWeather, risingNow,
      priority: stockDays !== null && stockDays < 21 ? 3 : (risingNow || similarWeather ? 2 : 1)
    });
  });

  const watchlist = categories.map((category) => {
    const currentWeek = categoryUnits(category, addDays(latestDate, -6), latestDate);
    const previousYearWeek = categoryUnits(category, addDays(priorAnchor, -6), priorAnchor);
    const changeRate = previousYearWeek >= MIN_COMPARE_UNITS ? ((currentWeek - previousYearWeek) / previousYearWeek) * 100 : null;
    const stock = products.filter((product) => categoryForProduct.get(product.id) === category && product.track_stock)
      .reduce((sum, product) => sum + Number(product.product_stock?.[0]?.quantity || 0), 0);
    return { category, currentWeek, previousYearWeek, changeRate, stock };
  }).filter((item) => item.currentWeek || item.previousYearWeek)
    .sort((a, b) => Math.abs(b.changeRate || 0) - Math.abs(a.changeRate || 0) || b.currentWeek - a.currentWeek)
    .slice(0, 4);

  return { alerts: alerts.sort((a, b) => b.priority - a.priority || b.increaseRate - a.increaseRate).slice(0, 6), watchlist, latestDate, settings, hasComparison: true };
}

// ---------- 분석 화면: 이익·마진율 중심 수익성 분석 ----------
const MIN_PRODUCT_REVENUE = 200000; // 상품 순위에 넣을 최소 매출(원). 판매가 너무 적은 상품은 마진율이 왜곡됨

function buildProfitAnalysis(sales, year, latestSaleDate, isLatestYear) {
  if (!analyticsProfit.length) return '<p class="seasonal-empty">이익 데이터를 불러오지 못했습니다. 원가 데이터를 확인해 주세요.</p>';
  const categoryOf = new Map(products.map((product) => [product.id, product.product_categories?.name || '기타']));
  const nameOf = new Map(products.map((product) => [product.id, product.name]));
  const rows = analyticsProfit.map((row) => ({
    date: row.sold_at.slice(0, 10), month: row.sold_at.slice(0, 7),
    amount: Number(row.amount), cost: Number(row.cost_amount), productId: row.product_id
  }));
  const previousYear = String(Number(year) - 1);
  const cutoff = isLatestYear ? latestSaleDate.slice(5, 10) : '12-31';
  const inYtd = (row, target) => row.date.startsWith(target) && row.date.slice(5, 10) <= cutoff;
  const totalOf = (list) => {
    const amount = list.reduce((sum, row) => sum + row.amount, 0);
    const cost = list.reduce((sum, row) => sum + row.cost, 0);
    return { amount, cost, profit: amount - cost, margin: amount > 0 ? ((amount - cost) / amount) * 100 : null };
  };
  const percentChange = (now, before) => (before > 0 ? ((now - before) / before) * 100 : null);
  const money = (value) => `${Math.round(value).toLocaleString('ko-KR')}원`;
  const nowRows = rows.filter((row) => inYtd(row, year));
  const beforeRows = rows.filter((row) => inYtd(row, previousYear));
  const now = totalOf(nowRows);
  const before = totalOf(beforeRows);
  const ordersNow = sales.filter((sale) => sale.sold_at.startsWith(year) && sale.sold_at.slice(5, 10) <= cutoff).length;
  const ordersBefore = sales.filter((sale) => sale.sold_at.startsWith(previousYear) && sale.sold_at.slice(5, 10) <= cutoff).length;
  const cutoffText = `${Number(cutoff.slice(0, 2))}월 ${Number(cutoff.slice(3, 5))}일`;

  // 상단 지표 카드: good은 증가가 좋은 지표(true)인지, 나쁜 지표(false: 원가)인지
  const card = (title, valueText, deltaText, change, good = true) => {
    const direction = change === null ? 'none' : (change >= 0) === good ? 'up' : 'down';
    return `<article><p>${title}</p><strong>${valueText}</strong><span>전년 동기 대비 <em class="kpi-delta ${direction}">${deltaText}</em></span></article>`;
  };
  const percentText = (change) => (change === null ? '비교 기록 없음' : `${change >= 0 ? '▲ +' : '▼ '}${change.toFixed(1)}%`);
  const marginDiff = now.margin !== null && before.margin !== null ? now.margin - before.margin : null;
  const profitPerOrderNow = ordersNow ? now.profit / ordersNow : 0;
  const profitPerOrderBefore = ordersBefore ? before.profit / ordersBefore : 0;
  const cards = [
    card('매출총이익', money(now.profit), percentText(percentChange(now.profit, before.profit)), percentChange(now.profit, before.profit)),
    card('마진율', now.margin === null ? '—' : `${now.margin.toFixed(1)}%`, marginDiff === null ? '비교 기록 없음' : `${marginDiff >= 0 ? '▲ +' : '▼ '}${marginDiff.toFixed(1)}%p`, marginDiff),
    card('원가 합계', money(now.cost), percentText(percentChange(now.cost, before.cost)), percentChange(now.cost, before.cost), false),
    card('주문 1건당 이익', money(profitPerOrderNow), percentText(percentChange(profitPerOrderNow, profitPerOrderBefore)), percentChange(profitPerOrderNow, profitPerOrderBefore))
  ].join('');

  // 분류별 수익성
  const byCategory = new Map();
  const addTo = (map, key, row) => {
    const entry = map.get(key) || { amount: 0, cost: 0 };
    entry.amount += row.amount; entry.cost += row.cost;
    map.set(key, entry);
  };
  nowRows.forEach((row) => addTo(byCategory, categoryOf.get(row.productId) || '기타', row));
  const beforeByCategory = new Map();
  beforeRows.forEach((row) => addTo(beforeByCategory, categoryOf.get(row.productId) || '기타', row));
  const categoryList = [...byCategory.entries()].map(([name, value]) => {
    const profit = value.amount - value.cost;
    const margin = value.amount > 0 ? (profit / value.amount) * 100 : 0;
    const previous = beforeByCategory.get(name);
    const previousMargin = previous && previous.amount >= MIN_COMPARE_AMOUNT ? ((previous.amount - previous.cost) / previous.amount) * 100 : null;
    return { name, amount: value.amount, profit, margin, revenueShare: now.amount ? (value.amount / now.amount) * 100 : 0, profitShare: now.profit ? (profit / now.profit) * 100 : 0, marginDiff: previousMargin === null ? null : margin - previousMargin };
  }).sort((a, b) => b.profit - a.profit);
  const averageMargin = now.margin ?? 0;
  categoryList.forEach((item) => {
    item.tags = [];
    if (item.revenueShare >= 10 && item.margin < averageMargin - 3) item.tags.push(['warn', '매출 큰데 마진 낮음']);
    if (item.profitShare >= 10 && item.margin >= averageMargin + 3) item.tags.push(['good', '수익 핵심']);
    if (item.marginDiff !== null && item.marginDiff <= -2) item.tags.push(['warn', '마진 하락']);
  });
  const marginMax = Math.max(...categoryList.map((item) => item.margin), 1);
  const categoryRows = categoryList.slice(0, 8).map((item) => `<tr>
      <td>${escapeText(item.name)}${item.tags.map(([kind, text]) => `<span class="profit-tag ${kind}">${text}</span>`).join('')}</td>
      <td>${money(item.amount)}</td><td>${money(item.profit)}</td>
      <td><div class="margin-cell"><b><i style="width:${Math.max(0, Math.round((item.margin / marginMax) * 100))}%"></i></b><span>${item.margin.toFixed(1)}%</span></div></td>
      <td>${item.profitShare.toFixed(1)}%</td>
      <td class="${item.marginDiff === null ? '' : item.marginDiff >= 0 ? 'up' : 'down'}">${item.marginDiff === null ? '—' : `${item.marginDiff >= 0 ? '▲ +' : '▼ '}${item.marginDiff.toFixed(1)}%p`}</td></tr>`).join('');

  // 상품별 수익성: 이익이 큰 상품 / 마진율이 낮은 상품
  const byProduct = new Map();
  nowRows.forEach((row) => addTo(byProduct, row.productId, row));
  const productList = [...byProduct.entries()].map(([id, value]) => ({
    name: nameOf.get(id) || '알 수 없는 상품', amount: value.amount, profit: value.amount - value.cost,
    margin: value.amount > 0 ? ((value.amount - value.cost) / value.amount) * 100 : 0
  })).filter((item) => item.amount >= MIN_PRODUCT_REVENUE);
  const topProfit = [...productList].sort((a, b) => b.profit - a.profit).slice(0, 5);
  const lowMargin = [...productList].sort((a, b) => a.margin - b.margin).slice(0, 5);
  const productTable = (list, mode) => `<table class="profit-table small"><thead><tr><th>상품</th><th>매출</th><th>${mode === 'profit' ? '이익' : '마진율'}</th></tr></thead><tbody>${list.map((item) => `<tr><td>${escapeText(item.name)}</td><td>${money(item.amount)}</td><td>${mode === 'profit' ? `${money(item.profit)} <small>(${item.margin.toFixed(1)}%)</small>` : `${item.margin.toFixed(1)}%`}</td></tr>`).join('') || '<tr><td colspan="3">기준을 넘는 상품이 없습니다.</td></tr>'}</tbody></table>`;

  // 월별 이익과 마진율 추이 (전체 기간)
  const monthMap = new Map();
  rows.forEach((row) => addTo(monthMap, row.month, row));
  const months = [...monthMap.keys()].sort();
  const monthData = months.map((month) => {
    const value = monthMap.get(month);
    const profit = value.amount - value.cost;
    return { month, profit, margin: value.amount > 0 ? (profit / value.amount) * 100 : 0 };
  });
  const profitMax = Math.max(...monthData.map((item) => item.profit), 1);
  const lowMarginValue = Math.min(...monthData.map((item) => item.margin)) - 2;
  const highMarginValue = Math.max(...monthData.map((item) => item.margin)) + 2;
  const slot = 600 / monthData.length;
  const bars = monthData.map((item, index) => {
    const height = Math.max(0, (item.profit / profitMax) * 150);
    return `<rect class="pbar ${item.month.startsWith(year) ? 'selected' : ''}" x="${(index * slot + slot * 0.2).toFixed(1)}" y="${(190 - height).toFixed(1)}" width="${(slot * 0.6).toFixed(1)}" height="${height.toFixed(1)}"><title>${item.month} · 이익 ${money(item.profit)} · 마진율 ${item.margin.toFixed(1)}%</title></rect>`;
  }).join('');
  const linePath = monthData.map((item, index) => {
    const y = 30 + (1 - (item.margin - lowMarginValue) / (highMarginValue - lowMarginValue)) * 130;
    return `${index ? 'L' : 'M'}${(index * slot + slot / 2).toFixed(1)} ${y.toFixed(1)}`;
  }).join(' ');
  const monthLabels = monthData.map((item) => `<span>${Number(item.month.slice(5, 7)) === 1 || item === monthData[0] ? `<small>${item.month.slice(2, 4)}년</small>` : ''}${Number(item.month.slice(5, 7))}</span>`).join('');

  // 자동 해석: 숫자에서 바로 읽히는 사실만 문장으로 정리
  const insights = [];
  if (marginDiff !== null) insights.push(`${year}년 ${cutoffText}까지 마진율은 ${now.margin.toFixed(1)}%로, 전년 같은 기간보다 ${Math.abs(marginDiff).toFixed(1)}%p ${marginDiff >= 0 ? '높습니다' : '낮습니다'}.`);
  const revenueChange = percentChange(now.amount, before.amount);
  const costChange = percentChange(now.cost, before.cost);
  if (revenueChange !== null && costChange !== null) insights.push(`매출은 ${revenueChange >= 0 ? '+' : ''}${revenueChange.toFixed(1)}%, 원가는 ${costChange >= 0 ? '+' : ''}${costChange.toFixed(1)}% 변했습니다.${costChange > revenueChange + 2 ? ' 원가가 매출보다 빠르게 늘어 마진이 줄 수 있습니다.' : ''}`);
  if (categoryList[0]) insights.push(`이익 기여 1위는 ${categoryList[0].name}으로 전체 이익의 ${categoryList[0].profitShare.toFixed(1)}%입니다.`);
  const weakCategories = categoryList.filter((item) => item.tags.some(([, text]) => text === '매출 큰데 마진 낮음'));
  if (weakCategories.length) insights.push(`${weakCategories.map((item) => item.name).join(', ')}은(는) 매출 비중이 큰데 마진율이 평균보다 낮습니다. 판매가나 매입 단가를 점검해 볼 만합니다.`);

  return `
    <p class="kpi-period">기준 기간: ${year}년 1월 1일 ~ ${cutoffText} · ${previousYear}년 같은 기간과 비교 (이익 = 매출 − 매입 원가)</p>
    <div class="analysis-kpis">${cards}</div>
    ${insights.length ? `<section class="profit-insights"><h3>한눈에 보기</h3><ul>${insights.map((text) => `<li>${escapeText(text)}</li>`).join('')}</ul></section>` : ''}
    <section class="profit-card">
      <div class="chart-title"><div><p class="eyebrow">PROFIT TREND</p><h3>월별 이익과 마진율 추이</h3></div><strong>마진율 ${Math.min(...monthData.map((item) => item.margin)).toFixed(1)}% ~ ${Math.max(...monthData.map((item) => item.margin)).toFixed(1)}%</strong></div>
      <div class="year-legend"><span><i class="legend-bar"></i>월 매출총이익 (진한 막대: ${year}년)</span><span><i class="legend-line"></i>마진율</span></div>
      <svg class="profit-chart" viewBox="0 0 600 220" preserveAspectRatio="none" role="img" aria-label="월별 이익과 마진율 추이"><line x1="0" y1="190" x2="600" y2="190"/><line x1="0" y1="120" x2="600" y2="120" class="guide"/><line x1="0" y1="50" x2="600" y2="50" class="guide"/>${bars}<path d="${linePath}"/></svg>
      <div class="profit-labels" style="grid-template-columns:repeat(${monthData.length},1fr)">${monthLabels}</div>
      <p class="profit-note">막대 위에 마우스를 올리면 월별 수치가 나옵니다. 마지막 달은 진행 중이라 이익이 작게 보일 수 있습니다.</p>
    </section>
    <section class="profit-card">
      <div class="chart-title"><div><p class="eyebrow">CATEGORY PROFITABILITY</p><h3>분류별 수익성</h3></div><strong>전체 마진율 ${now.margin === null ? '—' : `${now.margin.toFixed(1)}%`}</strong></div>
      <div class="table-wrap"><table class="profit-table category-table"><thead><tr><th>분류</th><th>매출</th><th>이익</th><th>마진율</th><th>이익 비중</th><th>마진율 변화(전년 동기)</th></tr></thead><tbody>${categoryRows}</tbody></table></div>
      <p class="profit-note">이익 순서입니다. "매출 큰데 마진 낮음"은 매출 비중 10% 이상이면서 마진율이 전체 평균보다 3%p 넘게 낮은 분류입니다.</p>
    </section>
    <section class="profit-card">
      <div class="chart-title"><div><p class="eyebrow">PRODUCT PROFITABILITY</p><h3>상품별 수익성</h3></div><strong>매출 ${Math.round(MIN_PRODUCT_REVENUE / 10000)}만 원 이상 상품</strong></div>
      <div class="profit-split"><div><h4>이익이 큰 상품 TOP 5</h4>${productTable(topProfit, 'profit')}</div><div><h4>마진율이 낮은 상품 5</h4>${productTable(lowMargin, 'margin')}</div></div>
    </section>`;
}

function renderAnalytics(sales, saleItems) {
  const view = document.querySelector('#analytics .panel');
  const years = [...new Set(sales.map((sale) => sale.sold_at.slice(0, 4)))].sort().reverse();
  if (!years.length) return;
  if (!years.includes(selectedAnalyticsYear)) selectedAnalyticsYear = years[0];
  const selectedSales = sales.filter((sale) => sale.sold_at.startsWith(selectedAnalyticsYear));
  const selectedSaleIds = new Set(selectedSales.map((sale) => sale.id));
  const selectedItems = saleItems.filter((item) => selectedSaleIds.has(item.sale_id));
  const latestSaleDate = sales.map((sale) => sale.sold_at.slice(0, 10)).sort().at(-1);
  const monthlySales = sales.reduce((result, sale) => {
    const key = sale.sold_at.slice(0, 7);
    result[key] = (result[key] || 0) + Number(sale.total_amount);
    return result;
  }, {});
  const yearSeries = years.map((year) => {
    const monthsWithSales = sales
      .filter((sale) => sale.sold_at.startsWith(year))
      .map((sale) => Number(sale.sold_at.slice(5, 7)));
    const lastRecordedMonth = Math.max(...monthsWithSales, 0);
    return {
      year,
      points: Array.from({ length: 12 }, (_, index) => index + 1 <= lastRecordedMonth
        ? monthlySales[`${year}-${String(index + 1).padStart(2, '0')}`] || 0
        : null)
    };
  });
  // 처음에는 선택한 연도의 마지막 판매월을 기본으로 누른 상태로 둠
  const activeMonth = selectedAnalyticsMonth === null
    ? yearSeries.find((series) => series.year === selectedAnalyticsYear).points.reduce((last, amount, index) => amount === null ? last : index + 1, 0)
    : selectedAnalyticsMonth;
  const revenue = selectedSales.reduce((sum, sale) => sum + Number(sale.total_amount), 0);
  const units = selectedItems.reduce((sum, item) => sum + Number(item.quantity), 0);
  const max = Math.max(...yearSeries.flatMap((series) => series.points.filter((amount) => amount !== null)), 1);
  const lineColors = ['#2f8a68', '#5b7cfa', '#e79a3b', '#ba5dd0', '#d65b6c'];
  const graphLines = yearSeries.map((series, seriesIndex) => {
    let drawing = false;
    const path = series.points.map((amount, index) => {
      if (amount === null) { drawing = false; return ''; }
      const x = 25 + index * 50;
      const y = 170 - (amount / max) * 125;
      const command = drawing ? 'L' : 'M';
      drawing = true;
      return `${command}${x} ${y}`;
    }).join(' ');
    return path ? `<path d="${path}" style="stroke:${lineColors[seriesIndex % lineColors.length]}"/>` : '';
  }).join('');
  const labels = Array.from({ length: 12 }, (_, index) => `<button type="button" class="month-pick ${activeMonth === index + 1 ? 'active' : ''}" data-month="${index + 1}" aria-pressed="${activeMonth === index + 1}">${index + 1}월</button>`).join('');
  const focusX = 25 + (activeMonth - 1) * 50;
  const monthFocus = activeMonth ? `<line class="month-focus" x1="${focusX}" y1="20" x2="${focusX}" y2="170"/>` : '';
  const calendarEvents = [
    { start: '2025-10-03', end: '2025-10-09', label: '추석·개천절·한글날 연휴', note: '장기 연휴 기간' },
    { start: '2026-09-24', end: '2026-09-26', label: '추석 연휴', note: '명절 운영 일정 확인' },
    { start: '2026-10-05', end: '2026-10-05', label: '개천절 대체공휴일', note: '거래처 운영일 확인' },
    { start: '2026-10-09', end: '2026-10-09', label: '한글날', note: '거래처 운영일 확인' }
  ].filter((event) => years.includes(event.start.slice(0, 4)) && event.start <= latestSaleDate);
  // 같은 기간(선택한 월, 없으면 연초~기준일)의 분류별 매출을 올해와 전년으로 나눠 계산
  const previousYear = String(Number(selectedAnalyticsYear) - 1);
  const cutoffDay = selectedAnalyticsYear === years[0] ? latestSaleDate.slice(5, 10) : '12-31';
  const lastSaleMonth = Number(latestSaleDate.slice(5, 7));
  // 올해 진행 중인 달은 전년도도 같은 날짜까지만 비교
  const partialMonth = selectedAnalyticsYear === years[0] && activeMonth === lastSaleMonth;
  const periodLabel = activeMonth
    ? `${activeMonth}월${partialMonth ? ` 1일 ~ ${Number(cutoffDay.slice(3, 5))}일` : ''}`
    : `1월 1일 ~ ${Number(cutoffDay.slice(0, 2))}월 ${Number(cutoffDay.slice(3, 5))}일`;
  const inPeriod = (soldAt) => activeMonth
    ? Number(soldAt.slice(5, 7)) === activeMonth && (!partialMonth || soldAt.slice(5, 10) <= cutoffDay)
    : soldAt.slice(5, 10) <= cutoffDay;
  const categoryTotalsOf = (year) => {
    const saleIds = new Set(sales.filter((sale) => sale.sold_at.startsWith(year) && inPeriod(sale.sold_at)).map((sale) => sale.id));
    return saleItems.reduce((result, item) => {
      if (!saleIds.has(item.sale_id)) return result;
      const product = products.find((entry) => entry.id === item.product_id);
      const category = product?.product_categories?.name || '기타';
      result[category] = (result[category] || 0) + Number(item.amount);
      return result;
    }, {});
  };
  const thisTotals = categoryTotalsOf(selectedAnalyticsYear);
  const lastTotals = categoryTotalsOf(previousYear);
  const rankOf = (totals) => Object.entries(totals).sort((a, b) => b[1] - a[1]).map(([name]) => name);
  const thisRank = rankOf(thisTotals);
  const lastRank = rankOf(lastTotals);
  const categories = thisRank.slice(0, 6).map((name, index) => {
    const now = thisTotals[name];
    const before = lastTotals[name] || 0;
    const lastPosition = lastRank.indexOf(name);
    return {
      name, now, before, rank: index + 1,
      rankMove: lastPosition === -1 ? null : lastPosition - index, // 양수면 순위 상승
      change: before >= MIN_COMPARE_AMOUNT ? ((now - before) / before) * 100 : null
    };
  });
  const changeMax = Math.max(...categories.map((item) => Math.abs(item.change || 0)), 10);
  const categoryRows = categories.map((item) => {
    const width = item.change === null ? 0 : Math.round((Math.abs(item.change) / changeMax) * 100);
    const direction = item.change === null ? 'none' : item.change >= 0 ? 'up' : 'down';
    const rankText = item.rankMove === null ? '신규' : item.rankMove > 0 ? `▲${item.rankMove}` : item.rankMove < 0 ? `▼${-item.rankMove}` : '－';
    const changeText = item.change === null ? (item.before > 0 ? '기준 적음' : '전년 없음') : `${item.change >= 0 ? '+' : ''}${Math.round(item.change)}%`;
    return `<div class="category-row"><em>${item.rank}</em><span>${item.name}<small>${Math.round(item.now / 10000).toLocaleString('ko-KR')}만 · 전년 ${Math.round(item.before / 10000).toLocaleString('ko-KR')}만</small></span><b class="${direction}"><i style="width:${width}%"></i></b><strong class="${direction}">${changeText}</strong><u>${rankText}</u></div>`;
  }).join('');
  const categoryBody = categories.length
    ? `<div class="category-rows">${categoryRows}</div>`
    : '<p class="seasonal-empty">선택한 기간의 판매 기록이 없습니다.</p>';
  const seasonal = buildSeasonalAlerts(sales, saleItems, analyticsWeather);
  const weatherOutlook = buildWeatherOutlook(sales, saleItems, analyticsWeather, analyticsForecast, analyticsForecastError);
  view.innerHTML = `
    <div class="analysis-heading"><div><p class="eyebrow">BUSINESS INTELLIGENCE</p><h2>수익성 분석</h2><p>이익과 마진율을 중심으로 시간 흐름과 분류·상품별 수익 구조를 살펴봅니다.</p></div><label class="analysis-year-label" for="analyticsYear">조회 연도<select id="analyticsYear">${years.map((year) => `<option value="${year}" ${year === selectedAnalyticsYear ? 'selected' : ''}>${year}년</option>`).join('')}</select></label></div>
    ${buildProfitAnalysis(sales, selectedAnalyticsYear, latestSaleDate, selectedAnalyticsYear === years[0])}
    <div class="analysis-grid">
      <section class="trend-card"><div class="chart-title"><div><p class="eyebrow">MONTH TREND</p><h3>연도별 월 매출 비교</h3></div><strong>전체 최고 ${Math.round(max).toLocaleString('ko-KR')}원</strong></div><div class="year-legend">${yearSeries.map((series, index) => `<span><i style="background:${lineColors[index % lineColors.length]}"></i>${series.year}년</span>`).join('')}</div><svg viewBox="0 0 600 200" preserveAspectRatio="none" role="img" aria-label="연도별 월 매출 비교"><line x1="0" y1="170" x2="600" y2="170"/><line x1="0" y1="105" x2="600" y2="105"/><line x1="0" y1="40" x2="600" y2="40"/>${monthFocus}${graphLines}</svg><div class="chart-labels">${labels}</div><div class="chart-events" aria-label="기간 중 주요 일정"><strong>기간 일정</strong>${calendarEvents.length ? calendarEvents.map((event) => `<span><b>${event.start}${event.end !== event.start ? ` ~ ${event.end}` : ''}</b>${event.label} · ${event.note}</span>`).join('') : '<span>표시할 명절·공휴일 일정이 없습니다.</span>'}</div></section>
      <section class="category-card"><p class="eyebrow">CATEGORY CHANGE</p><h3>분류별 전년 대비 증감</h3><p class="category-period">${selectedAnalyticsYear}년 vs ${previousYear}년 · ${periodLabel}${activeMonth ? ' <button type="button" class="month-reset" id="monthReset">연초부터 누계로 보기</button>' : ' · 아래 월 버튼을 누르면 그 달만 비교'}</p>${categoryBody}</section>
    </div>
    ${weatherOutlook}
    <section class="seasonal-panel"><div class="seasonal-heading"><div><p class="eyebrow">SEASONAL DEMAND INTELLIGENCE</p><h3>계절성 수요 알림</h3><p>${seasonal.latestDate ? `${seasonal.latestDate} 판매 기록 기준 · 전년도 동일 시점의 다음 ${seasonal.settings.leadDays}일을 비교합니다.` : '판매 기록을 불러오는 중입니다.'}</p></div><div class="seasonal-settings"><label>증가 기준<input id="seasonalityThreshold" type="number" min="1" max="200" value="${seasonal.settings.threshold}" />%</label><label>사전 알림<input id="seasonalityLeadDays" type="number" min="7" max="60" value="${seasonal.settings.leadDays}" />일 전</label></div></div>
      <p class="weather-note">날씨 비교: ${seasonal.latestDate || '기준일 없음'}의 기존 기록과 전년도 수요 증가 시점의 기록을 사용합니다. 향후 7일 예보는 현재 연결된 데이터에 없어 표시하지 않습니다.</p>
      <div class="seasonal-alert-list">${seasonal.alerts.length ? seasonal.alerts.map((alert) => `<article class="seasonal-alert ${alert.priority >= 2 ? 'high' : ''}"><div><p class="alert-category">${alert.category}</p><h4>작년 ${formatDate(alert.lastYearStart)}부터 수요가 ${Math.round(alert.increaseRate)}% 증가했습니다.</h4><p>최근 추세 ${alert.currentChange === null ? '비교 데이터 부족' : `${alert.currentChange >= 0 ? '+' : ''}${Math.round(alert.currentChange)}%`} · ${alert.weatherText}</p></div><dl><div><dt>작년 성수기 1주</dt><dd>${Math.round(alert.seasonUnits).toLocaleString('ko-KR')}</dd></div><div><dt>올해 최근 4주</dt><dd>${Math.round(alert.currentFourWeek).toLocaleString('ko-KR')}</dd></div><div><dt>현재 재고</dt><dd>${Math.round(alert.stock).toLocaleString('ko-KR')}</dd></div><div><dt>예상 소진</dt><dd>${alert.stockDays === null ? '산정 불가' : `${alert.stockDays}일`}</dd></div></dl><p class="alert-action">${alert.priority >= 2 ? '권장: 발주 필요 여부를 지금 확인하세요.' : '권장: 성수기 전 재고와 발주 일정을 점검하세요.'}</p></article>`).join('') : `<p class="seasonal-empty">이번 주에는 사전 알림 조건을 만족한 분류가 없습니다. 아래 전년 동일 주 비교로 변화를 확인하세요.</p>`}</div>
      <section class="seasonal-watch"><h4>전년 동일 주 비교</h4><div>${seasonal.watchlist.map((item) => `<article><p>${item.category}</p><strong>${item.changeRate === null ? '비교 불가' : `${item.changeRate >= 0 ? '+' : ''}${Math.round(item.changeRate)}%`}</strong><span>올해 ${Math.round(item.currentWeek)} · 전년 ${Math.round(item.previousYearWeek)} · 재고 ${Math.round(item.stock)}</span></article>`).join('') || '<p class="seasonal-empty">전년 동일 주 비교 데이터가 없습니다.</p>'}</div></section>
    </section>`;
  const dashboardCharts = document.querySelector('#dashboardCharts');
  const dashboardInsights = document.querySelector('#dashboardInsights');
  const analysisGrid = view.querySelector('.analysis-grid');
  if (dashboardCharts && dashboardInsights && analysisGrid) {
    dashboardCharts.replaceChildren(analysisGrid);
    dashboardInsights.hidden = false;
  }
  document.querySelectorAll('.month-pick').forEach((button) => button.addEventListener('click', () => {
    const month = Number(button.dataset.month);
    selectedAnalyticsMonth = activeMonth === month ? 0 : month;
    renderAnalytics(analyticsSales, analyticsSaleItems);
  }));
  document.querySelector('#monthReset')?.addEventListener('click', () => {
    selectedAnalyticsMonth = 0;
    renderAnalytics(analyticsSales, analyticsSaleItems);
  });
  document.querySelector('#analyticsYear').addEventListener('change', (event) => {
    selectedAnalyticsYear = event.target.value;
    selectedAnalyticsMonth = null;
    renderAnalytics(analyticsSales, analyticsSaleItems);
  });
  ['seasonalityThreshold', 'seasonalityLeadDays'].forEach((id) => {
    document.querySelector(`#${id}`).addEventListener('change', () => {
      localStorage.setItem('pharmacy-seasonality-settings', JSON.stringify({
        threshold: Number(document.querySelector('#seasonalityThreshold').value) || 30,
        leadDays: Number(document.querySelector('#seasonalityLeadDays').value) || 5
      }));
      renderAnalytics(analyticsSales, analyticsSaleItems);
    });
  });
}

// ---------- 판매 내역 (판매 관리 화면 하단) ----------
const salesHistoryMonth = document.querySelector('#salesHistoryMonth');
const salesHistorySummary = document.querySelector('#salesHistorySummary');
const salesHistoryMessage = document.querySelector('#salesHistoryMessage');
const salesHistoryBody = document.querySelector('#salesHistoryBody');

const won = (value) => `${Math.round(value).toLocaleString('ko-KR')}원`;
const countText = (value) => Number(value.toFixed(3)).toLocaleString('ko-KR');
const escapeText = (value) => String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

// 판매가 있는 월 목록을 만들고 최근 월을 선택
async function prepareSalesHistory() {
  try {
    const latest = await (await api('sales?select=sold_at&status=eq.completed&order=sold_at.desc&limit=1')).json();
    const oldest = await (await api('sales?select=sold_at&status=eq.completed&order=sold_at.asc&limit=1')).json();
    if (!latest.length) { salesHistoryMessage.textContent = '등록된 판매 내역이 없습니다.'; return; }
    const months = [];
    let [year, month] = latest[0].sold_at.slice(0, 7).split('-').map(Number);
    const first = oldest[0].sold_at.slice(0, 7);
    while (`${year}-${String(month).padStart(2, '0')}` >= first) {
      months.push(`${year}-${String(month).padStart(2, '0')}`);
      month -= 1;
      if (month === 0) { month = 12; year -= 1; }
    }
    salesHistoryMonth.replaceChildren(...months.map((value) => new Option(`${value.slice(0, 4)}년 ${Number(value.slice(5, 7))}월`, value)));
    salesHistoryMonth.disabled = false;
    await loadSalesHistory();
  } catch (error) {
    salesHistoryMessage.textContent = '판매 내역을 불러오지 못했습니다.';
  }
}

async function loadSalesHistory() {
  const month = salesHistoryMonth.value;
  if (!month) return;
  const nextMonth = addDays(`${month}-01`, 32).slice(0, 7);
  try {
    const rows = await apiAll(`sale_items?select=product_id,quantity,amount,sales!inner(id,sold_at,status)&sales.status=eq.completed&sales.sold_at=gte.${month}-01&sales.sold_at=lt.${nextMonth}-01&order=id.asc`);
    salesHistoryRows = rows.map((row) => ({
      saleId: row.sales.id, date: row.sales.sold_at.slice(0, 10), productId: row.product_id,
      quantity: Number(row.quantity), amount: Number(row.amount)
    }));
    renderSalesHistory();
  } catch (error) {
    salesHistoryRows = [];
    salesHistoryBody.replaceChildren();
    salesHistorySummary.hidden = true;
    salesHistoryMessage.textContent = '판매 내역을 불러오지 못했습니다.';
  }
}

function renderSalesHistory() {
  const rows = salesHistoryRows;
  if (!rows.length) {
    salesHistorySummary.hidden = true;
    salesHistoryBody.replaceChildren();
    salesHistoryMessage.textContent = '선택한 월의 판매 내역이 없습니다.';
    return;
  }
  const productById = new Map(products.map((product) => [product.id, product]));
  const totalAmount = rows.reduce((sum, row) => sum + row.amount, 0);
  const totalQuantity = rows.reduce((sum, row) => sum + row.quantity, 0);
  const saleCount = new Set(rows.map((row) => row.saleId)).size;
  const dayCount = new Set(rows.map((row) => row.date)).size;
  salesHistorySummary.textContent = `${salesHistoryMonth.value} · 판매 ${saleCount.toLocaleString('ko-KR')}건 · 수량 ${countText(totalQuantity)}개 · 매출액 ${won(totalAmount)} · 영업일 평균 ${won(totalAmount / dayCount)}`;
  salesHistorySummary.hidden = false;
  salesHistoryMessage.textContent = salesHistoryView === 'daily'
    ? '날짜를 누르면 그날 판매한 품목을 볼 수 있습니다.'
    : '매출액이 큰 품목 순서입니다. 비중은 이 달 전체 매출액 대비입니다.';

  if (salesHistoryView === 'daily') {
    const byDate = new Map();
    rows.forEach((row) => {
      const day = byDate.get(row.date) || { sales: new Set(), quantity: 0, amount: 0, items: new Map() };
      day.sales.add(row.saleId);
      day.quantity += row.quantity;
      day.amount += row.amount;
      const item = day.items.get(row.productId) || { quantity: 0, amount: 0 };
      item.quantity += row.quantity;
      item.amount += row.amount;
      day.items.set(row.productId, item);
      byDate.set(row.date, day);
    });
    const dates = [...byDate.keys()].sort().reverse();
    salesHistoryBody.innerHTML = `<div class="table-wrap"><div class="history-head"><span>일자</span><span>건수</span><span>판매수량</span><span>매출액</span></div>
      ${dates.map((date, index) => {
        const day = byDate.get(date);
        const itemRows = [...day.items.entries()].sort((a, b) => b[1].amount - a[1].amount).map(([productId, item]) => {
          const product = productById.get(productId);
          return `<tr><td>${escapeText(product?.name || '알 수 없는 상품')}</td><td></td><td>${countText(item.quantity)}</td><td>${won(item.amount)}</td></tr>`;
        }).join('');
        return `<details class="history-day" ${index === 0 ? 'open' : ''}><summary><span>${date}</span><span>${day.sales.size}건</span><span>${countText(day.quantity)}개</span><strong>${won(day.amount)}</strong></summary><table class="history-table history-items"><colgroup><col style="width:34.1%"><col style="width:14.6%"><col style="width:22%"><col style="width:29.3%"></colgroup><tbody>${itemRows}</tbody></table></details>`;
      }).join('')}
      <div class="history-total"><span>월 합계</span><span>${saleCount}건</span><span>${countText(totalQuantity)}개</span><strong>${won(totalAmount)}</strong></div></div>`;
  } else {
    const byProduct = new Map();
    rows.forEach((row) => {
      const item = byProduct.get(row.productId) || { quantity: 0, amount: 0 };
      item.quantity += row.quantity;
      item.amount += row.amount;
      byProduct.set(row.productId, item);
    });
    const list = [...byProduct.entries()].sort((a, b) => b[1].amount - a[1].amount);
    salesHistoryBody.innerHTML = `<div class="table-wrap"><table class="history-table"><thead><tr><th>상품명</th><th>분류</th><th>판매수량</th><th>매출액</th><th>비중</th></tr></thead><tbody>
      ${list.map(([productId, item]) => {
        const product = productById.get(productId);
        return `<tr><td>${escapeText(product?.name || '알 수 없는 상품')}</td><td>${escapeText(product?.product_categories?.name || '기타')}</td><td>${countText(item.quantity)}</td><td>${won(item.amount)}</td><td>${(item.amount / totalAmount * 100).toFixed(1)}%</td></tr>`;
      }).join('')}
      <tr class="history-sum"><td>월 합계</td><td></td><td>${countText(totalQuantity)}</td><td>${won(totalAmount)}</td><td>100%</td></tr></tbody></table></div>`;
  }
}

salesHistoryMonth.addEventListener('change', loadSalesHistory);
document.querySelectorAll('.history-tab').forEach((tab) => tab.addEventListener('click', () => {
  salesHistoryView = tab.dataset.historyView;
  document.querySelectorAll('.history-tab').forEach((other) => {
    other.classList.toggle('active', other === tab);
    other.setAttribute('aria-selected', String(other === tab));
  });
  renderSalesHistory();
}));

async function loadDashboard() {
  let sales;
  try {
    sales = await apiAll('sales?select=sold_at,total_amount,status&status=eq.completed&order=sold_at.asc');
  } catch (error) {
    return;
  }
  if (!sales.length) {
    setDashboardValue(0, '0원', '등록된 판매가 없습니다');
    setDashboardValue(1, '0건', '등록된 판매가 없습니다');
    await showStockAlert(null);
    setDashboardValue(3, '—', '판매 데이터 연결 후 표시');
    return;
  }
  const latestDay = sales.map((sale) => sale.sold_at.slice(0, 10)).sort().at(-1);
  const latestMonth = latestDay?.slice(0, 7);
  const todaySales = sales.filter((sale) => sale.sold_at.slice(0, 10) === latestDay);
  const monthSales = sales.filter((sale) => sale.sold_at.startsWith(latestMonth));
  const todayTotal = todaySales.reduce((sum, sale) => sum + Number(sale.total_amount), 0);
  const monthTotal = monthSales.reduce((sum, sale) => sum + Number(sale.total_amount), 0);
  setDashboardValue(0, `${todayTotal.toLocaleString('ko-KR')}원`, `${latestDay} 최신 영업일 기준`);
  setDashboardValue(1, `${todaySales.length}건`, `${latestDay} 최신 영업일 기준`);
  await showStockAlert(latestDay);
  if (currentProfile?.role !== 'admin' || !latestMonth) {
    setDashboardValue(3, '—', '관리자 전용 지표');
    return;
  }
  // 마진율 = (매출 - 원가) / 매출. 최근 판매월과 그 전달을 함께 계산해 증감을 보여줌
  const marginOfMonth = async (month, revenue) => {
    const [year, monthNumber] = month.split('-').map(Number);
    const nextMonth = `${year + (monthNumber === 12 ? 1 : 0)}-${String(monthNumber === 12 ? 1 : monthNumber + 1).padStart(2, '0')}-01`;
    const rows = await apiAll(`v_sale_items_profit?select=amount,cost_amount&status=eq.completed&sold_at=gte.${month}-01&sold_at=lt.${nextMonth}`);
    const itemTotal = rows.reduce((sum, item) => sum + Number(item.amount), 0);
    const costTotal = rows.reduce((sum, item) => sum + Number(item.cost_amount), 0);
    const base = itemTotal || revenue;
    return base > 0 ? ((base - costTotal) / base) * 100 : null;
  };
  try {
    const previousMonth = addDays(`${latestMonth}-01`, -1).slice(0, 7);
    const previousRevenue = sales.filter((sale) => sale.sold_at.startsWith(previousMonth)).reduce((sum, sale) => sum + Number(sale.total_amount), 0);
    const marginRate = await marginOfMonth(latestMonth, monthTotal);
    const previousRate = await marginOfMonth(previousMonth, previousRevenue);
    if (marginRate === null) { setDashboardValue(3, '—', `${latestMonth} 판매 기록 없음`); return; }
    const diff = previousRate === null ? '' : ` · 전월 대비 ${marginRate - previousRate >= 0 ? '+' : ''}${(marginRate - previousRate).toFixed(1)}%p`;
    setDashboardValue(3, `${marginRate.toFixed(1)}%`, `${latestMonth} 매출총이익률${diff}`);
  } catch (error) {
    setDashboardValue(3, '—', '원가 데이터 확인 필요');
  }
}

// 최근 4주 판매 속도로 계산해 7일 안에 떨어질 상품 수를 보여줌 (판매가 늘면 숫자도 늘어남)
async function showStockAlert(latestDay) {
  const tracked = products.filter((product) => product.track_stock);
  const stockOf = (product) => Number(product.product_stock?.[0]?.quantity ?? 0);
  let soldByProduct = null;
  try {
    const since = addDays(latestDay, -27);
    const rows = await apiAll(`sale_items?select=product_id,quantity,sales!inner(sold_at,status)&sales.status=eq.completed&sales.sold_at=gte.${since}`);
    soldByProduct = rows.reduce((result, row) => {
      result.set(row.product_id, (result.get(row.product_id) || 0) + Number(row.quantity));
      return result;
    }, new Map());
  } catch (error) {
    soldByProduct = null;
  }
  if (!soldByProduct) {
    // 판매 기록을 못 읽으면 기존처럼 재고 5개 이하로 계산
    const low = tracked.filter((product) => stockOf(product) <= 5);
    setDashboardValue(2, `${low.length}개`, '재고 5개 이하 상품');
    return;
  }
  const risky = tracked.map((product) => {
    const dailySales = (soldByProduct.get(product.id) || 0) / 28;
    const stock = stockOf(product);
    return { name: product.name, stock, days: dailySales > 0 ? stock / dailySales : null };
  }).filter((item) => item.stock <= 0 || (item.days !== null && item.days < 7))
    .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  const first = risky[0];
  setDashboardValue(2, `${risky.length}개`, first
    ? `7일 안에 소진 예상 · 가장 급한 상품: ${first.name}${first.days === null ? '' : ` (${first.days.toFixed(1)}일)`}`
    : '7일 안에 소진될 상품 없음');
}

async function refreshProductsAfterSale() {
  try {
    products = await apiAll('products?select=id,code,name,sale_price,track_stock,product_stock(quantity),product_costs(purchase_price),product_categories(name)&order=code');
  } catch {
    throw new Error('최신 재고 정보를 불러오지 못했습니다.');
  }
  if (currentProfile?.role === 'admin') {
    await loadInventoryMovements();
    prepareInventoryLedger();
  } else {
    renderProducts(productSearch.value);
  }
}

function renderSale() {
  const rows = document.querySelector('#saleRows');
  const total = saleItems.reduce((sum, item) => sum + item.sale_price * item.quantity, 0);
  rows.replaceChildren(...saleItems.map((item, index) => {
    const row = document.createElement('tr');
    [item.name, item.quantity, `${(item.sale_price * item.quantity).toLocaleString('ko-KR')}원`, item.petLabel || '—'].forEach((value) => {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    });
    const removeCell = document.createElement('td');
    const removeButton = document.createElement('button');
    removeButton.textContent = '삭제';
    removeButton.addEventListener('click', () => { saleItems.splice(index, 1); renderSale(); });
    removeCell.append(removeButton); row.append(removeCell); return row;
  }));
  document.querySelector('#saleTableWrap').hidden = saleItems.length === 0;
  document.querySelector('#saleFooter').hidden = saleItems.length === 0;
  document.querySelector('#saleTotal').textContent = `합계 ${total.toLocaleString('ko-KR')}원`;
}

function prepareSales() {
  saleProductSearch.disabled = false;
  saleProductValue.value = '';
  saleProductSearch.value = '';
  saleProductHint.textContent = '상품명·코드·초성을 입력하거나 입력창을 눌러 추천 상품을 확인하세요.';
  document.querySelector('#saleQuantity').disabled = false;
  saleDate.disabled = false;
  saleDate.max = getLocalDate();
  saleDate.value = getLocalDate();
  document.querySelector('#addSaleItem').disabled = false;
  document.querySelector('#saleMessage').textContent = '상품을 선택해 판매 목록에 담으세요.';
  salePetSearch.disabled = false;
  salePetNewButton.disabled = false;
  salePetSearch.value = '';
  salePetId.value = '';
  loadSalePetOptions();
}

function preparePetSearch() {
  petSearchInput.disabled = false;
  petSearchButton.disabled = false;
  petMicButton.disabled = !petRecognition;
  petSearchHint.hidden = true;
  petSearchMessage.textContent = '';
  newPetToggle.disabled = false;
}

async function searchPets(name) {
  const query = name.trim();
  petDetailPanel.hidden = true;
  if (!query) { petSearchMessage.textContent = '이름을 입력하거나 말해 주세요.'; return; }
  petSearchMessage.textContent = '검색 중...';
  try {
    const response = await api('rpc/rpc_search_pets_by_name', { method: 'POST', body: JSON.stringify({ p_name: query }) });
    if (!response.ok) throw new Error('검색에 실패했습니다.');
    renderPetCandidates(await response.json());
  } catch (error) {
    petSearchMessage.textContent = error.message;
    petCandidatesWrap.hidden = true;
  }
}

function renderPetCandidates(results) {
  if (!results.length) {
    petCandidatesWrap.hidden = true;
    petSearchMessage.textContent = '일치하는 반려동물을 찾지 못했습니다. 이름을 다시 확인해 주세요.';
    return;
  }
  petSearchMessage.textContent = `${results.length}건을 찾았습니다. 하나를 선택하세요.`;
  petCandidatesWrap.hidden = false;
  petCandidateRows.replaceChildren(...results.map((pet) => {
    const row = document.createElement('tr');
    [pet.pet_name, petSpeciesLabel[pet.species] || pet.species, pet.breed || '—', pet.last_visit_on || '—', pet.owner_name_masked].forEach((value) => {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    });
    const actionCell = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'pet-candidate-select'; button.textContent = '상세보기';
    button.addEventListener('click', () => showPetDetail(pet.pet_id));
    actionCell.append(button);
    row.append(actionCell);
    return row;
  }));
}

async function showPetDetail(petId) {
  selectedPetId = petId;
  petSearchMessage.textContent = '불러오는 중...';
  try {
    const [detailResponse, visitResponse, purchaseResponse] = await Promise.all([
      api('rpc/rpc_get_pet_detail', { method: 'POST', body: JSON.stringify({ p_pet_id: petId }) }),
      api(`pet_visits?select=visit_date,record,detail&pet_id=eq.${petId}&order=visit_date.desc.nullslast`),
      api(`sale_items?select=quantity,amount,products(name),sales(sold_at)&pet_id=eq.${petId}`)
    ]);
    if (!detailResponse.ok) throw new Error('상세 정보를 불러오지 못했습니다.');
    const [detail] = await detailResponse.json();
    if (!detail) throw new Error('상세 정보를 찾지 못했습니다.');
    const purchases = purchaseResponse.ok ? await purchaseResponse.json() : [];
    purchases.sort((a, b) => (b.sales?.sold_at || '').localeCompare(a.sales?.sold_at || ''));
    renderPetDetail(detail, visitResponse.ok ? await visitResponse.json() : [], purchases);
    petSearchMessage.textContent = '';
  } catch (error) {
    petSearchMessage.textContent = error.message;
  }
}

function renderPetDetail(detail, visits, purchases = []) {
  petDetailPanel.hidden = false;
  petDetailName.textContent = `${detail.pet_name} (${petSpeciesLabel[detail.species] || detail.species}${detail.breed ? ' · ' + detail.breed : ''})`;
  const fields = [
    ['보호자', detail.owner_name || '—'],
    ['연락처', detail.owner_phone || '—'],
    ['성별', `${petSexLabel[detail.sex] || '미상'}${detail.neutered ? ' (중성화)' : ''}`],
    ['생년월일', detail.birth_date || '—'],
    ['체중', detail.weight_kg ? `${detail.weight_kg}kg` : '—'],
    ['털색', detail.coat_color || '—'],
    ['마지막 방문일', detail.last_visit_on || '—']
  ];
  petDetailInfo.replaceChildren(...fields.map(([label, value]) => {
    const div = document.createElement('div');
    const labelSpan = document.createElement('span'); labelSpan.textContent = label;
    const valueTag = document.createElement('b'); valueTag.textContent = value;
    div.append(labelSpan, valueTag);
    return div;
  }));
  petDetailNotes.textContent = detail.notes || '기록된 진료기록이 없습니다.';
  if (!visits.length) {
    petVisitRows.replaceChildren();
    petVisitEmpty.hidden = false;
  } else {
    petVisitEmpty.hidden = true;
    petVisitRows.replaceChildren(...visits.map((visit) => {
      const row = document.createElement('tr');
      [visit.visit_date, visit.record || '—', visit.detail || '—'].forEach((value) => {
        const cell = document.createElement('td'); cell.textContent = value ?? '—'; row.append(cell);
      });
      return row;
    }));
  }
  petVisitDate.value = getLocalDate();
  petVisitRecord.value = '';
  petVisitDetail.value = '';
  petVisitFormMessage.textContent = '';

  if (!purchases.length) {
    petPurchaseRows.replaceChildren();
    petPurchaseEmpty.hidden = false;
  } else {
    petPurchaseEmpty.hidden = true;
    petPurchaseRows.replaceChildren(...purchases.map((row) => {
      const tr = document.createElement('tr');
      [row.sales?.sold_at?.slice(0, 10) || '—', row.products?.name || '—', row.quantity, `${Math.round(row.amount).toLocaleString('ko-KR')}원`].forEach((value) => {
        const cell = document.createElement('td'); cell.textContent = value; tr.append(cell);
      });
      return tr;
    }));
  }
}

function renderPurchaseProductOptions(keyword = '') {
  const candidates = products.filter((product) => product.track_stock && matchesProduct(product, keyword)).slice(0, 20);
  purchaseProductOptions.replaceChildren(...candidates.map((product) => {
    const option = document.createElement('option');
    option.value = product.name;
    option.label = `${product.code} · 재고 ${product.product_stock?.[0]?.quantity ?? '—'}개`;
    return option;
  }));
}

function findPurchaseProduct() {
  const entered = purchaseProductSearch.value.trim().toLowerCase();
  if (!entered) return null;
  return products.find((product) => product.track_stock && (product.name.toLowerCase() === entered || product.code.toLowerCase() === entered)) || null;
}

function renderPurchase() {
  const rows = document.querySelector('#purchaseRows');
  const total = purchaseItems.reduce((sum, item) => sum + item.quantity * item.unitCost, 0);
  rows.replaceChildren(...purchaseItems.map((item, index) => {
    const row = document.createElement('tr');
    [item.name, item.quantity, `${item.unitCost.toLocaleString('ko-KR')}원`, `${Math.round(item.quantity * item.unitCost).toLocaleString('ko-KR')}원`].forEach((value) => {
      const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
    });
    const removeCell = document.createElement('td');
    const removeButton = document.createElement('button');
    removeButton.type = 'button'; removeButton.textContent = '삭제';
    removeButton.addEventListener('click', () => { purchaseItems.splice(index, 1); renderPurchase(); });
    removeCell.append(removeButton); row.append(removeCell); return row;
  }));
  document.querySelector('#purchaseTableWrap').hidden = purchaseItems.length === 0;
  document.querySelector('#purchaseFooter').hidden = purchaseItems.length === 0;
  document.querySelector('#purchaseTotal').textContent = `합계 ${Math.round(total).toLocaleString('ko-KR')}원`;
}

function preparePurchases() {
  purchaseSupplier.replaceChildren(new Option('거래처를 선택하세요', ''), ...suppliers.map((supplier) => new Option(supplier.name, supplier.id)));
  [purchaseSupplier, purchaseDate, purchaseProductSearch, purchaseQuantity, purchaseUnitCost, purchaseLotNo, purchaseExpiryDate, document.querySelector('#addPurchaseItem')].forEach((element) => { element.disabled = false; });
  purchaseDate.value = getLocalDate();
  purchaseDate.max = getLocalDate();
  purchaseExpiryDate.min = getLocalDate();
  renderPurchaseProductOptions();
  document.querySelector('#purchaseMessage').textContent = '거래처와 입고일을 확인한 뒤 실제 입고 수량과 매입 단가를 입력하세요.';
}

async function loadSuppliers() {
  const response = await api('suppliers?select=id,name&order=name');
  if (!response.ok) throw new Error('거래처 정보를 불러오지 못했습니다.');
  suppliers = await response.json();
}

// 읽은 댓글 시점은 이 브라우저에만 저장 (로그인한 사용자별)
function readMarks() {
  try { return JSON.parse(localStorage.getItem(`task-comment-read-${currentUser?.id}`) || '{}'); } catch { return {}; }
}
function markTaskRead(taskId) {
  const list = taskComments.get(taskId) || [];
  if (!list.length) return;
  const marks = readMarks();
  marks[taskId] = list[list.length - 1].created_at;
  try { localStorage.setItem(`task-comment-read-${currentUser?.id}`, JSON.stringify(marks)); } catch { /* 저장 불가 시 무시 */ }
}
// 댓글이 있으면 작은 말풍선을 만들어 돌려줌. 내가 읽지 않은 남의 댓글이 있으면 '안 읽음' 색
function makeCommentBubble(taskId) {
  const list = taskComments.get(taskId) || [];
  if (!list.length) return null;
  const seenAt = readMarks()[taskId] || '';
  const unread = list.filter((comment) => comment.author_id !== currentUser?.id && comment.created_at > seenAt).length;
  const bubble = document.createElement('i');
  bubble.className = `comment-bubble ${unread ? 'unread' : 'read'}`;
  bubble.textContent = unread ? String(unread) : String(list.length);
  bubble.title = unread ? `읽지 않은 댓글 ${unread}개` : `댓글 ${list.length}개 (읽음)`;
  bubble.setAttribute('aria-label', bubble.title);
  return bubble;
}

async function loadTasks() {
  const response = await api('action_tasks?select=id,title,description,status,priority,due_date,created_by,created_at,task_assignees(user_id)&order=due_date.asc');
  if (!response.ok) return;
  tasks = await response.json();
  try {
    const commentRows = await apiAll('task_comments?select=task_id,author_id,created_at&order=created_at.asc,id.asc');
    taskComments = commentRows.reduce((result, row) => result.set(row.task_id, [...(result.get(row.task_id) || []), row]), new Map());
  } catch { taskComments = new Map(); }
  if (currentProfile?.role === 'admin') {
    const profilesResponse = await api('profiles?select=id,display_name,role&active=eq.true&order=display_name');
    if (profilesResponse.ok) {
      teamMembers = await profilesResponse.json();
      const select = document.querySelector('#newTaskAssignee');
      select.replaceChildren(new Option('담당자 선택', ''), ...teamMembers.map((member) => new Option(`${member.display_name} (${member.role === 'admin' ? '대표' : '직원'})`, member.id)));
    }
  }
  renderCalendar();
}

function renderCalendar() {
  const grid = document.querySelector('#taskCalendar');
  const year = calendarDate.getFullYear(); const month = calendarDate.getMonth();
  document.querySelector('#calendarTitle').textContent = `${year}.${String(month + 1).padStart(2, '0')}`;
  grid.replaceChildren();
  const first = new Date(year, month, 1).getDay();
  const days = new Date(year, month + 1, 0).getDate();
  for (let index = 0; index < first + days; index += 1) {
    const day = document.createElement('button'); day.type = 'button'; day.className = 'task-day';
    if (index < first) { day.classList.add('muted'); grid.append(day); continue; }
    const date = `${year}-${String(month + 1).padStart(2, '0')}-${String(index - first + 1).padStart(2, '0')}`;
    const dayTasks = tasks.filter((task) => task.due_date === date);
    day.innerHTML = `<time>${index - first + 1}</time>`;
    dayTasks.slice(0, 2).forEach((task) => { const chip = document.createElement('span'); chip.className = `task-chip ${task.status}`; const bubble = makeCommentBubble(task.id); if (bubble) chip.append(bubble); chip.append(task.title); day.append(chip); });
    day.addEventListener('click', () => { if (dayTasks[0]) showTask(dayTasks[0]); });
    grid.append(day);
  }
}

async function showTask(task) {
  selectedTask = task;
  document.querySelector('#taskDetailTitle').textContent = task.title;
  document.querySelector('#taskDetailMeta').textContent = `${task.due_date || '마감일 없음'} · ${task.priority === 'high' ? '높은 우선순위' : '일반 우선순위'}${task.description ? ` · ${task.description}` : ''}`;
  const controls = document.querySelector('#taskStatusControls');
  const assigned = task.task_assignees?.some((item) => item.user_id === currentUser.id);
  controls.hidden = !(currentProfile?.role === 'admin' || assigned);
  document.querySelector('#taskStatus').value = task.status;
  document.querySelector('#commentForm').hidden = false;
  const response = await api(`task_comments?select=id,author_id,body,created_at&task_id=eq.${task.id}&order=created_at.asc`);
  const comments = response.ok ? await response.json() : [];
  taskComments.set(task.id, comments.map((comment) => ({ task_id: task.id, author_id: comment.author_id, created_at: comment.created_at })));
  markTaskRead(task.id);
  renderCalendar();
  const profilesResponse = await api('profiles?select=id,display_name');
  const names = profilesResponse.ok ? new Map((await profilesResponse.json()).map((profile) => [profile.id, profile.display_name])) : new Map();
  const list = document.querySelector('#commentList'); list.replaceChildren(...comments.map((comment) => { const item = document.createElement('article'); item.className = 'comment'; item.innerHTML = `<b>${names.get(comment.author_id) || '사용자'}</b><span></span>`; item.querySelector('span').textContent = comment.body; return item; }));
}

const SESSION_STORAGE_KEY = 'pharmacy-session';

function saveSession(session) {
  try { localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ refresh_token: session.refresh_token })); } catch {}
}

function clearSession() {
  try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch {}
}

async function signOut() {
  if (accessToken) await fetch(`${config.supabaseUrl}/auth/v1/logout`, { method: 'POST', headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}` } });
  clearSession();
  window.location.reload();
}

// 로그인(비밀번호) 또는 새로고침 후 세션 복원(refresh_token) 양쪽에서 공용으로 쓰는 로그인 완료 처리
async function completeLogin(session) {
  accessToken = session.access_token;
  currentUser = session.user;
  try {
    products = await apiAll('products?select=id,code,name,sale_price,track_stock,product_stock(quantity),product_costs(purchase_price),product_categories(name)&order=code');
  } catch {
    throw new Error('상품 정보를 불러오지 못했습니다.');
  }
  productSearch.disabled = false;
  productMessage.hidden = true;
  productTableWrap.hidden = false;
  renderProducts();
  prepareSales();
  preparePetSearch();
  loadPetVisitSuggestions();
  const profileResponse = await fetch(`${config.supabaseUrl}/rest/v1/profiles?select=role&id=eq.${session.user.id}`, { headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}` } });
  const profile = profileResponse.ok ? (await profileResponse.json())[0] : null;
  currentProfile = profile;
  document.querySelector('#roleBadge').textContent = profile?.role === 'admin' ? '현재 상태: admin (관리자)' : profile?.role === 'staff' ? '현재 상태: staff (직원)' : '현재 상태: 권한 확인 필요';
  document.querySelector('#roleBadge').dataset.role = profile?.role || '';
  await loadTasks();
  await loadDashboard();
  prepareSalesHistory();
  if (profile?.role !== 'admin') {
    document.querySelector('[data-view="analytics"]').hidden = true;
  } else {
    document.querySelector('#ownerTaskForm').hidden = false;
    document.querySelector('#purchaseNav').hidden = false;
    document.querySelector('#structureNav').hidden = false;
    document.querySelector('#legacySalesNav').hidden = false;
    loadLegacySales();
    renderSiteStructure();
    document.querySelector('#purchaseQuickAction')?.removeAttribute('hidden');
    try {
      await Promise.all([loadSuppliers(), loadInventoryMovements()]);
      preparePurchases();
      prepareInventoryLedger();
    } catch (error) {
      document.querySelector('#purchaseMessage').textContent = error.message;
      productMessage.textContent = error.message;
    }
    const itemResponse = await apiAllResponse('sale_items?select=sale_id,product_id,quantity,amount&order=id.asc');
    const salesResponse = await apiAllResponse('sales?select=id,sold_at,total_amount,status&status=eq.completed&order=id.asc');
    try {
      analyticsProfit = await apiAll('v_sale_items_profit?select=sold_at,product_id,quantity,amount,cost_amount&status=eq.completed&order=sale_item_id.asc');
    } catch (error) {
      analyticsProfit = [];
    }
    const weatherResponse = await fetch(`${config.supabaseUrl}/rest/v1/environmental_data?select=date,temp_max,temp_min,temp_mean,precipitation_mm&order=date`, { headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}` } });
    if (itemResponse.ok && salesResponse.ok) {
      const completedSales = await salesResponse.json();
      const completedIds = new Set(completedSales.map((sale) => sale.id));
      const completedItems = (await itemResponse.json()).filter((item) => completedIds.has(item.sale_id));
      analyticsSales = completedSales;
      analyticsSaleItems = completedItems;
      analyticsWeather = weatherResponse.ok ? await weatherResponse.json() : [];
      renderAnalytics(analyticsSales, analyticsSaleItems);
      loadSeoulForecast().then((forecast) => {
        analyticsForecast = forecast;
        analyticsForecastError = '';
        renderAnalytics(analyticsSales, analyticsSaleItems);
      }).catch((error) => {
        analyticsForecast = [];
        analyticsForecastError = error.message;
        renderAnalytics(analyticsSales, analyticsSaleItems);
      });
    }
  }
  loginButton.textContent = '로그아웃';
  saveSession(session);
}

async function restoreSession() {
  let saved;
  try { saved = JSON.parse(localStorage.getItem(SESSION_STORAGE_KEY) || 'null'); } catch { saved = null; }
  if (!saved?.refresh_token || !hasConfig()) return;
  try {
    const auth = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
      method: 'POST',
      headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: saved.refresh_token })
    });
    if (!auth.ok) { clearSession(); return; }
    const session = await auth.json();
    await completeLogin(session);
  } catch {
    clearSession();
  }
}

loginButton.addEventListener('click', () => {
  if (accessToken) {
    signOut();
    return;
  }
  if (!hasConfig()) { document.querySelector('#loginMessage').textContent = 'config.js 설정이 필요합니다.'; loginDialog.showModal(); return; }
  loginDialog.showModal();
});
document.querySelector('#closeLogin').addEventListener('click', () => loginDialog.close());
petSearchButton.addEventListener('click', () => searchPets(petSearchInput.value));
petSearchInput.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); searchPets(petSearchInput.value); } });
petMicButton.addEventListener('click', () => {
  if (!petRecognition) return;
  petMicButton.classList.add('listening');
  petSearchMessage.textContent = '듣는 중... 반려동물 이름을 말씀해 주세요.';
  try { petRecognition.start(); } catch { petMicButton.classList.remove('listening'); }
});
petVisitForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedPetId) return;
  const record = petVisitRecord.value.trim();
  if (!record) { petVisitRecord.focus(); return; }
  petVisitFormMessage.textContent = '등록 중...';
  try {
    const response = await api('rpc/rpc_add_pet_visit', {
      method: 'POST',
      body: JSON.stringify({ p_pet_id: selectedPetId, p_visit_date: petVisitDate.value || null, p_record: record, p_detail: petVisitDetail.value.trim() || null })
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message || '등록에 실패했습니다.');
    }
    await showPetDetail(selectedPetId);
    petVisitFormMessage.textContent = '등록되었습니다.';
    loadPetVisitSuggestions();
  } catch (error) {
    petVisitFormMessage.textContent = error.message;
  }
});
let newPetOrigin = 'pets'; // 'pets' | 'sales' — 등록 완료 후 어디로 이어줄지 구분

function openNewPetDialog(origin) {
  newPetOrigin = origin;
  newPetFormMessage.textContent = '';
  newPetDialog.showModal();
  document.querySelector('#newOwnerName').focus();
}
newPetToggle.addEventListener('click', () => openNewPetDialog('pets'));
salePetNewButton.addEventListener('click', () => openNewPetDialog('sales'));
salePetSearch.addEventListener('input', updateSalePetHistory);
salePetSearch.addEventListener('change', updateSalePetHistory);
document.querySelector('#closeNewPetDialog').addEventListener('click', () => newPetDialog.close());
newPetForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const ownerName = document.querySelector('#newOwnerName').value.trim();
  const petName = document.querySelector('#newPetName').value.trim();
  if (!ownerName) { document.querySelector('#newOwnerName').focus(); return; }
  if (!petName) { document.querySelector('#newPetName').focus(); return; }
  newPetFormMessage.textContent = '등록 중...';
  const neuteredValue = document.querySelector('#newPetNeutered').value;
  const weightValue = document.querySelector('#newPetWeight').value;
  try {
    const response = await api('rpc/rpc_create_pet', {
      method: 'POST',
      body: JSON.stringify({
        p_owner_name: ownerName,
        p_owner_phone: document.querySelector('#newOwnerPhone').value.trim() || null,
        p_pet_name: petName,
        p_species: document.querySelector('#newPetSpecies').value,
        p_breed: document.querySelector('#newPetBreed').value.trim() || null,
        p_sex: document.querySelector('#newPetSex').value,
        p_neutered: neuteredValue === '' ? null : neuteredValue === 'true',
        p_birth_date: document.querySelector('#newPetBirth').value || null,
        p_coat_color: document.querySelector('#newPetCoat').value.trim() || null,
        p_weight_kg: weightValue === '' ? null : Number(weightValue)
      })
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message || '등록에 실패했습니다.');
    }
    const newPetId = await response.json();
    const label = `${petName} (${ownerName})`;
    newPetForm.reset();
    newPetDialog.close();
    if (newPetOrigin === 'sales') {
      salePetDirectory.set(label, newPetId);
      salePetOptions.append(new Option(label));
      salePetSearch.value = label;
      updateSalePetHistory();
      document.querySelector('#saleMessage').textContent = `${label} 등록 완료 — 이 반려동물로 판매를 담을 수 있습니다.`;
      saleProductSearch.focus();
    } else {
      petCandidatesWrap.hidden = true;
      await showPetDetail(newPetId);
    }
  } catch (error) {
    newPetFormMessage.textContent = error.message;
  }
});
productSearch.addEventListener('input', () => renderProducts(productSearch.value));
ledgerMonth.addEventListener('change', (event) => {
  selectedLedgerMonth = event.target.value;
  renderProducts(productSearch.value);
});
purchaseProductSearch.addEventListener('input', () => renderPurchaseProductOptions(purchaseProductSearch.value));
purchaseProductSearch.addEventListener('change', () => {
  if (findPurchaseProduct()) purchaseQuantity.focus();
});
saleProductSearch.addEventListener('focus', () => renderProductSuggestions(saleProductSearch.value));
saleProductSearch.addEventListener('input', () => {
  saleProductValue.value = '';
  renderProductSuggestions(saleProductSearch.value);
});
saleProductSearch.addEventListener('keydown', (event) => {
  if (event.key === 'ArrowDown') { event.preventDefault(); renderProductSuggestions(saleProductSearch.value); moveSuggestion(1); }
  if (event.key === 'ArrowUp') { event.preventDefault(); renderProductSuggestions(saleProductSearch.value); moveSuggestion(-1); }
  if (event.key === 'Escape') closeProductSuggestions();
  if (event.key === 'Enter') {
    event.preventDefault();
    const options = [...saleProductSuggestions.querySelectorAll('.product-suggestion')];
    const selectedOption = options[activeSuggestionIndex] || options[0];
    selectedOption?.click();
  }
});
document.addEventListener('click', (event) => {
  if (!event.target.closest('.sale-product-picker')) closeProductSuggestions();
});
document.querySelector('#previousMonth').addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() - 1); renderCalendar(); });
document.querySelector('#nextMonth').addEventListener('click', () => { calendarDate.setMonth(calendarDate.getMonth() + 1); renderCalendar(); });
document.querySelector('#saveTaskStatus').addEventListener('click', async () => { if (!selectedTask) return; const status = document.querySelector('#taskStatus').value; const response = await api(`action_tasks?id=eq.${selectedTask.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); if (response.ok) { selectedTask.status = status; await loadTasks(); } });
document.querySelector('#commentForm').addEventListener('submit', async (event) => { event.preventDefault(); if (!selectedTask) return; const body = document.querySelector('#commentBody').value.trim(); if (!body) return; const response = await api('task_comments', { method: 'POST', body: JSON.stringify({ task_id: selectedTask.id, body }) }); if (response.ok) { document.querySelector('#commentBody').value = ''; showTask(selectedTask); } });
document.querySelector('#newTaskForm').addEventListener('submit', async (event) => { event.preventDefault(); const title = document.querySelector('#newTaskTitle').value.trim(); const assignee = document.querySelector('#newTaskAssignee').value; if (!title || !assignee) return; const response = await api('action_tasks', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ title, due_date: document.querySelector('#newTaskDueDate').value || null, priority: document.querySelector('#newTaskPriority').value }) }); if (response.ok) { const [task] = await response.json(); const assigned = await api('task_assignees', { method: 'POST', body: JSON.stringify({ task_id: task.id, user_id: assignee }) }); if (assigned.ok) { event.target.reset(); await loadTasks(); } } });

document.querySelector('#loginForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const message = document.querySelector('#loginMessage');
  message.textContent = '';
  try {
    const email = document.querySelector('#email').value;
    const password = document.querySelector('#password').value;
    const auth = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    if (!auth.ok) throw new Error('이메일 또는 비밀번호를 확인하세요.');
    const session = await auth.json();
    await completeLogin(session);
    loginDialog.close();
  } catch (error) { message.textContent = error.message; }
});

document.querySelector('#addSaleItem').addEventListener('click', () => {
  const selected = products.find((product) => product.code === saleProductValue.value);
  const quantity = Number(document.querySelector('#saleQuantity').value);
  if (!selected) { saleProductSearch.focus(); saleProductHint.textContent = '목록에서 상품을 하나 선택해 주세요.'; return; }
  if (!Number.isFinite(quantity) || quantity <= 0) { document.querySelector('#saleQuantity').focus(); return; }
  const petLabel = salePetSearch.value.trim();
  const petId = petLabel ? salePetDirectory.get(petLabel) || null : null;
  const existing = saleItems.find((item) => item.id === selected.id && item.petId === petId);
  if (existing) existing.quantity += quantity;
  else saleItems.push({ ...selected, quantity, petId, petLabel: petId ? petLabel : null });
  rememberProduct(selected);
  renderSale();
  saleProductValue.value = '';
  saleProductSearch.value = '';
  document.querySelector('#saleQuantity').value = 1;
  saleProductHint.textContent = '다음 상품을 입력하세요. 최근 선택 상품은 입력창을 누르면 다시 표시됩니다.';
  saleProductSearch.focus();
});

document.querySelector('#addPurchaseItem').addEventListener('click', () => {
  const product = findPurchaseProduct();
  const quantity = Number(purchaseQuantity.value);
  const unitCost = Number(purchaseUnitCost.value);
  const message = document.querySelector('#purchaseMessage');
  if (!product) { purchaseProductSearch.focus(); message.textContent = '목록에서 재고 관리 상품을 선택해 주세요.'; return; }
  if (!Number.isFinite(quantity) || quantity <= 0) { purchaseQuantity.focus(); return; }
  if (!Number.isFinite(unitCost) || unitCost < 0 || purchaseUnitCost.value === '') { purchaseUnitCost.focus(); return; }
  const existing = purchaseItems.find((item) => item.id === product.id && item.unitCost === unitCost && item.lotNo === purchaseLotNo.value.trim() && item.expiryDate === purchaseExpiryDate.value);
  if (existing) existing.quantity += quantity;
  else purchaseItems.push({ id: product.id, name: product.name, quantity, unitCost, lotNo: purchaseLotNo.value.trim(), expiryDate: purchaseExpiryDate.value });
  renderPurchase();
  purchaseProductSearch.value = '';
  purchaseQuantity.value = 1;
  purchaseUnitCost.value = '';
  purchaseLotNo.value = '';
  purchaseExpiryDate.value = '';
  message.textContent = '입고 목록에 담았습니다. 다음 상품을 입력하세요.';
  purchaseProductSearch.focus();
});

purchaseUnitCost.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') { event.preventDefault(); document.querySelector('#addPurchaseItem').click(); }
});

document.querySelector('#saleQuantity').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    document.querySelector('#addSaleItem').click();
  }
});

document.querySelector('#submitSale').addEventListener('click', async () => {
  const message = document.querySelector('#saleMessage');
  if (saleItems.length === 0) return;
  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/rpc_create_sale`, {
      method: 'POST',
      headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_idempotency_key: crypto.randomUUID(), p_payment_method: document.querySelector('#paymentMethod').value, p_items: saleItems.map((item) => ({ product_id: item.id, quantity: item.quantity, pet_id: item.petId || null })), ...(saleDate.value !== getLocalDate() ? { p_sold_at: saleDate.value } : {}) })
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message || errorBody.hint || '판매 등록에 실패했습니다. 재고 수량을 확인하세요.');
    }
    const saleId = await response.json();
    saleItems = []; renderSale();
    salePetSearch.value = ''; salePetId.value = '';
    try {
      await Promise.all([refreshProductsAfterSale(), loadDashboard(), prepareSalesHistory()]);
      message.textContent = `판매가 등록되었습니다. 판매 번호: ${saleId} · 대시보드와 판매 내역에 반영되었습니다.`;
    } catch {
      message.textContent = `판매가 등록되었습니다. 판매 번호: ${saleId} · 대시보드는 새로고침 후 확인해 주세요.`;
    }
  } catch (error) { message.textContent = error.message; }
});

document.querySelector('#submitPurchase').addEventListener('click', async () => {
  const message = document.querySelector('#purchaseMessage');
  if (!purchaseSupplier.value) { purchaseSupplier.focus(); message.textContent = '거래처를 선택해 주세요.'; return; }
  if (!purchaseDate.value) { purchaseDate.focus(); return; }
  if (!purchaseItems.length) { purchaseProductSearch.focus(); message.textContent = '입고할 상품을 목록에 담아 주세요.'; return; }
  try {
    const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/rpc_receive_purchase`, {
      method: 'POST',
      headers: { apikey: config.supabasePublishableKey, Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_supplier_id: Number(purchaseSupplier.value), p_purchased_at: purchaseDate.value, p_items: purchaseItems.map((item) => ({ product_id: item.id, quantity: item.quantity, unit_cost: item.unitCost, lot_no: item.lotNo, expiry_date: item.expiryDate })) })
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      throw new Error(errorBody.message || errorBody.hint || '입고 등록에 실패했습니다. 거래처와 수량, 단가를 확인해 주세요.');
    }
    const purchaseId = await response.json();
    purchaseItems = []; renderPurchase();
    await Promise.all([refreshProductsAfterSale(), loadDashboard()]);
    message.textContent = `입고가 등록되었습니다. 입고 번호: ${purchaseId} · 재고와 대시보드에 반영되었습니다.`;
  } catch (error) { message.textContent = error.message; }
});

restoreSession();
