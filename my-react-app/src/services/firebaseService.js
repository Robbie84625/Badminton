// src/services/firebaseService.js
import { initializeApp } from "firebase/app";
import { getDatabase, ref, onValue, runTransaction } from "firebase/database";

const firebaseConfig = {
  databaseURL: "https://badminton-e0324-default-rtdb.asia-southeast1.firebasedatabase.app"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

export function createEmptyState() {
  return {
    players: [],
    currentMatch: null,
    upcomingMatch: null,
    history: [],
    isRosterLocked: false,
    version: 1,
    updatedAt: Date.now()
  };
}

// 取得房間參考路徑
export function getRoomRef(roomId) {
  return ref(db, `rooms/${roomId}`);
}

// 監聽房間即時資料變化
export function subscribeToRoom(roomId, onDataChange) {
  const roomRef = getRoomRef(roomId);
  return onValue(roomRef, (snapshot) => {
    const data = snapshot.val();
    if (data) {
      onDataChange({
        players: data.players || [],
        currentMatch: data.currentMatch || null,
        upcomingMatch: data.upcomingMatch || null,
        history: data.history || [],
        isRosterLocked: Boolean(data.isRosterLocked),
        version: data.version || 1,
        updatedAt: data.updatedAt || Date.now()
      });
    } else {
      onDataChange(createEmptyState());
    }
  });
}

// 樂觀鎖寫入器（防止多人同時按按鈕互相覆蓋）
export function commitStateChange(roomId, mutatorFn, onDone) {
  const roomRef = getRoomRef(roomId);
  let abortReason = null;

  runTransaction(roomRef, (currentRemoteData) => {
    abortReason = null;
    const baseState = currentRemoteData ? {
      players: currentRemoteData.players || [],
      currentMatch: currentRemoteData.currentMatch || null,
      upcomingMatch: currentRemoteData.upcomingMatch || null,
      history: currentRemoteData.history || [],
      isRosterLocked: Boolean(currentRemoteData.isRosterLocked),
      version: currentRemoteData.version || 0
    } : createEmptyState();

    const result = mutatorFn(baseState);
    if (typeof result === 'string') {
      abortReason = result;
      return; // 中止交易
    }
    if (!result) return;

    result.version = (baseState.version || 0) + 1;
    result.updatedAt = Date.now();
    return result;
  }).then(({ committed, snapshot }) => {
    if (!committed && abortReason) {
      alert(abortReason);
      return;
    }
    if (committed && onDone) {
      onDone(snapshot.val());
    }
  }).catch((error) => {
    console.error('Firebase Transaction Error:', error);
    alert('網路同步發生異常，請重試！');
  });
}