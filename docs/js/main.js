// サーバーURL: 本番では Render の URL に変更
const SERVER_URL = window.location.hostname === 'localhost'
  ? 'http://localhost:3000'
  : 'https://your-render-app.onrender.com'; // ← デプロイ後に変更

const socket = io(SERVER_URL);

// ===== State =====
let myId = null;
let myNumber = null;
let roomPlayers = [];
let timerInterval = null;
let gameEndTime = null;
let selectedCategoryId = null;
let selectedAttributeId = null;
let roomCounts = {};

// ===== Screen helpers =====
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// ===== Lobby =====
const inputName    = document.getElementById('input-name');
const categoryList = document.getElementById('category-list');
const attributeList = document.getElementById('attribute-list');
const comboInfo    = document.getElementById('combo-info');
const btnJoin      = document.getElementById('btn-join');
const lobbyError   = document.getElementById('lobby-error');

socket.on('connect', () => { myId = socket.id; });

socket.emit('get-themes');

socket.on('themes', ({ categories, attributes }) => {
  categoryList.innerHTML = '';
  categories.forEach((cat) => {
    const btn = document.createElement('button');
    btn.className = 'theme-btn';
    btn.dataset.id = cat.id;
    btn.innerHTML = `<div class="theme-name">${cat.label}</div>`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('#category-list .theme-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedCategoryId = cat.id;
      updateAttributeBadges();
      updateComboInfo();
      updateJoinButton();
    });
    categoryList.appendChild(btn);
  });

  attributeList.innerHTML = '';
  attributes.forEach((attr) => {
    const btn = document.createElement('button');
    btn.className = 'theme-btn';
    btn.dataset.id = attr.id;
    btn.innerHTML = `<div class="theme-name">${attr.label}</div><div class="theme-desc">${attr.description}</div>`;
    btn.addEventListener('click', () => {
      document.querySelectorAll('#attribute-list .theme-btn').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedAttributeId = attr.id;
      updateComboInfo();
      updateJoinButton();
    });
    attributeList.appendChild(btn);
  });
});

socket.on('room-counts', (counts) => {
  roomCounts = counts;
  updateAttributeBadges();
  updateComboInfo();
});

function updateAttributeBadges() {
  document.querySelectorAll('#attribute-list .theme-btn').forEach((btn) => {
    const existing = btn.querySelector('.waiting-badge');
    if (existing) existing.remove();

    if (!selectedCategoryId) return;
    const key = `${selectedCategoryId}_${btn.dataset.id}`;
    const count = roomCounts[key] || 0;
    if (count > 0) {
      const badge = document.createElement('div');
      badge.className = 'waiting-badge';
      badge.textContent = `${count}人待機中`;
      btn.appendChild(badge);
    }
  });
}

function updateComboInfo() {
  if (!selectedCategoryId || !selectedAttributeId) {
    comboInfo.textContent = '';
    comboInfo.className = 'combo-info';
    return;
  }
  const key = `${selectedCategoryId}_${selectedAttributeId}`;
  const count = roomCounts[key] || 0;
  if (count > 0) {
    comboInfo.textContent = `現在 ${count} 人が待機中！すぐに遊べます`;
    comboInfo.className = 'combo-info has-players';
  } else {
    comboInfo.textContent = 'まだ誰も待機していません。最初の参加者になりましょう！';
    comboInfo.className = 'combo-info no-players';
  }
}

inputName.addEventListener('input', updateJoinButton);

function updateJoinButton() {
  btnJoin.disabled = !inputName.value.trim() || !selectedCategoryId || !selectedAttributeId;
}

btnJoin.addEventListener('click', () => {
  const name = inputName.value.trim();
  if (!name || !selectedCategoryId || !selectedAttributeId) return;
  lobbyError.textContent = '';
  socket.emit('join-room', { name, categoryId: selectedCategoryId, attributeId: selectedAttributeId });
});

// ===== Waiting room =====
const waitingThemeLabel = document.getElementById('waiting-theme-label');
const waitingRoomId     = document.getElementById('waiting-room-id');
const playerListEl      = document.getElementById('player-list');
const btnReady          = document.getElementById('btn-ready');

socket.on('room-joined', ({ roomId, themeLabel, players }) => {
  roomPlayers = players;
  waitingThemeLabel.textContent = themeLabel;
  waitingRoomId.textContent = `#${roomId}`;
  renderPlayerList();
  showScreen('screen-waiting');
});

socket.on('player-joined', ({ player }) => {
  roomPlayers.push(player);
  renderPlayerList();
});

socket.on('player-left', ({ playerId, players }) => {
  roomPlayers = players;
  renderPlayerList();
});

socket.on('player-ready-updated', ({ players }) => {
  roomPlayers = players;
  renderPlayerList();
});

function renderPlayerList() {
  playerListEl.innerHTML = '';
  roomPlayers.forEach((p) => {
    const li = document.createElement('li');
    const isMe = p.id === myId;
    li.innerHTML = `
      <span class="pname">${escHtml(p.name)}${isMe ? ' （あなた）' : ''}</span>
      <span class="pstatus ${p.isReady ? 'ready' : ''}">${p.isReady ? '準備OK' : '待機中'}</span>
    `;
    playerListEl.appendChild(li);
  });
}

btnReady.addEventListener('click', () => {
  btnReady.disabled = true;
  socket.emit('player-ready');
});

// ===== Game =====
const gameThemeLabel = document.getElementById('game-theme-label');
const gameThemeDesc  = document.getElementById('game-theme-desc');
const myCardNumber   = document.getElementById('my-card-number');
const timerEl        = document.getElementById('timer');
const submitStatus   = document.getElementById('submit-status');
const chatMessages   = document.getElementById('chat-messages');
const chatInput      = document.getElementById('chat-input');
const btnChatSend    = document.getElementById('btn-chat-send');
const chatCharCount  = document.getElementById('chat-char-count');
const btnSubmit      = document.getElementById('btn-submit');

socket.on('game-started', ({ yourNumber, themeLabel, themeDescription, durationSec, playerCount }) => {
  myNumber = yourNumber;
  myCardNumber.textContent = yourNumber;
  gameThemeLabel.textContent = themeLabel;
  gameThemeDesc.textContent = themeDescription;

  submitStatus.innerHTML = '';
  roomPlayers.forEach((p) => {
    const chip = document.createElement('span');
    chip.className = 'submit-chip';
    chip.id = `chip-${p.id}`;
    chip.textContent = p.name;
    submitStatus.appendChild(chip);
  });

  chatMessages.innerHTML = '';
  btnSubmit.disabled = false;

  gameEndTime = Date.now() + durationSec * 1000;
  startTimer();

  showScreen('screen-game');
});

function startTimer() {
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    const remaining = Math.max(0, gameEndTime - Date.now());
    const m = Math.floor(remaining / 60000);
    const s = Math.floor((remaining % 60000) / 1000);
    timerEl.textContent = `${m}:${String(s).padStart(2, '0')}`;

    timerEl.classList.remove('warning', 'danger');
    if (remaining <= 30000) timerEl.classList.add('danger');
    else if (remaining <= 60000) timerEl.classList.add('warning');

    if (remaining === 0) {
      clearInterval(timerInterval);
      btnSubmit.disabled = true;
      btnSubmit.textContent = '時間切れ';
    }
  }, 500);
}

// Chat
chatInput.addEventListener('input', () => {
  chatCharCount.textContent = chatInput.value.length;
});

chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendChat();
  }
});

btnChatSend.addEventListener('click', sendChat);

function sendChat() {
  const text = chatInput.value.trim();
  if (!text) return;
  socket.emit('chat-message', { text });
  chatInput.value = '';
  chatCharCount.textContent = '0';
}

socket.on('chat-message', ({ playerId, playerName, text }) => {
  const div = document.createElement('div');
  div.className = `chat-msg${playerId === myId ? ' mine' : ''}`;
  div.innerHTML = `<span class="sender">${escHtml(playerName)}</span><span class="text">${escHtml(text)}</span>`;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});

// Submit
btnSubmit.addEventListener('click', () => {
  btnSubmit.disabled = true;
  socket.emit('submit-card');
});

socket.on('card-submitted', ({ playerId }) => {
  const chip = document.getElementById(`chip-${playerId}`);
  if (chip) chip.classList.add('done');
});

// ===== Result =====
const resultBanner = document.getElementById('result-banner');
const resultTbody  = document.getElementById('result-tbody');
const btnRetry     = document.getElementById('btn-retry');

socket.on('game-ended', ({ isSuccess, results }) => {
  clearInterval(timerInterval);

  resultBanner.textContent = isSuccess ? '成功！ 全員の心が繋がった！' : '失敗… 順番がズレてしまった';
  resultBanner.className = `result-banner ${isSuccess ? 'success' : 'failure'}`;

  const sorted = [...results].sort((a, b) => {
    if (a.submissionOrder === null) return 1;
    if (b.submissionOrder === null) return -1;
    return a.submissionOrder - b.submissionOrder;
  });

  resultTbody.innerHTML = '';
  sorted.forEach((r) => {
    const tr = document.createElement('tr');
    const notSubmitted = r.submissionOrder === null;
    if (r.isViolation) tr.classList.add('violation');
    else if (notSubmitted) tr.classList.add('not-submitted');
    const time = r.submittedAt ? new Date(r.submittedAt).toLocaleTimeString('ja-JP') : '時間切れ';
    tr.innerHTML = `
      <td>${notSubmitted ? '未提出' : r.submissionOrder}</td>
      <td>${escHtml(r.name)}${r.id === myId ? ' 👤' : ''}</td>
      <td>${r.number}</td>
      <td>${time}</td>
    `;
    resultTbody.appendChild(tr);
  });

  showScreen('screen-result');
});

btnRetry.addEventListener('click', () => {
  myNumber = null;
  roomPlayers = [];
  selectedCategoryId = null;
  selectedAttributeId = null;
  document.querySelectorAll('.theme-btn').forEach((b) => b.classList.remove('selected'));
  document.querySelectorAll('.waiting-badge').forEach((b) => b.remove());
  comboInfo.textContent = '';
  comboInfo.className = 'combo-info';
  btnReady.disabled = false;
  btnSubmit.textContent = 'カードを出す';
  inputName.value = '';
  updateJoinButton();
  showScreen('screen-lobby');
});

// ===== Utils =====
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
