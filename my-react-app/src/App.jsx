import { useState, useEffect } from 'react';
import './App.css';
import { pickFourPlayers, generateUpcomingMatch } from './utils/matchmaker';
import { createEmptyState, subscribeToRoom, commitStateChange } from './services/firebaseService';

function App() {
  const roomId = window.location.hash.replace('#', '') || 'main-court';

  const [state, setState] = useState(createEmptyState());
  const [isSynced, setIsSynced] = useState(false);

  const [isRosterExpanded, setIsRosterExpanded] = useState(true);
  const [rosterText, setRosterText] = useState('');

  const [showSwapModal, setShowSwapModal] = useState(false);
  const [swapOutId, setSwapOutId] = useState('');
  const [swapInId, setSwapInId] = useState('');
  const [showEndModal, setShowEndModal] = useState(false);

  useEffect(() => {
    const unsubscribe = subscribeToRoom(roomId, (newData) => {
      setState(newData);
      setIsSynced(true);

      if (newData.isRosterLocked && newData.players && newData.players.length > 0) {
        setRosterText(newData.players.map(p => p.name).join('\n'));
      }
    });
    return () => unsubscribe();
  }, [roomId]);

  const players = state.players || [];
  const activePlayers = players.filter(p => p.status === 'active');
  const getName = (id) => (players.find(p => p.id === id) || {}).name || '未知';

  const handleRosterButtonClick = () => {
    if (state.isRosterLocked) {
      commitStateChange(roomId, (remoteState) => {
        remoteState.isRosterLocked = false;
        return remoteState;
      });
    } else {
      const lines = rosterText
        .split('\n')
        .map(s => s.trim())
        .filter(s => s.length > 0);

      commitStateChange(roomId, (remoteState) => {
        const existingPlayers = remoteState.players || [];
        const newPlayers = lines.map(name => {
          const exist = existingPlayers.find(p => p.name === name);
          if (exist) return exist;
          return {
            id: '_' + Math.random().toString(36).substr(2, 9),
            name: name,
            status: 'active',
            played: 0,
            consecutivePlay: 0,
            consecutiveRest: 0
          };
        });

        remoteState.players = newPlayers;
        remoteState.isRosterLocked = true;

        if (remoteState.currentMatch) {
          remoteState.upcomingMatch = generateUpcomingMatch(
            remoteState.currentMatch,
            remoteState.players,
            remoteState.history
          );
        }
        return remoteState;
      });
    }
  };

  const updatePlayerName = (id, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    commitStateChange(roomId, (remoteState) => {
      const p = remoteState.players.find(x => x.id === id);
      if (!p || p.name === trimmed) return null;
      p.name = trimmed;
      return remoteState;
    });
  };

  const changePlayerStatus = (id, newStatus) => {
    commitStateChange(roomId, (remoteState) => {
      const p = remoteState.players.find(x => x.id === id);
      if (!p) return null;
      p.status = newStatus;
      if (remoteState.currentMatch) {
        remoteState.upcomingMatch = generateUpcomingMatch(
          remoteState.currentMatch,
          remoteState.players,
          remoteState.history
        );
      }
      return remoteState;
    });
  };

  const handleFinishAndNext = () => {
    if (!state.isRosterLocked) {
      alert('⚠️ 名單尚在編輯中，請先點擊「儲存名冊」鎖定後再進行排賽！');
      setIsRosterExpanded(true);
      return;
    }

    const wasPlayingLocally = Boolean(state.currentMatch);
    let postMessage = null;

    commitStateChange(roomId, (remoteState) => {
      if (!remoteState.isRosterLocked) {
        return '⚠️ 名單剛剛被其他管理員解鎖編輯中，請先確認並「儲存名冊」後再排賽！';
      }
      if (wasPlayingLocally && !remoteState.currentMatch) {
        return '⚠️ 賽況剛剛已被其他管理員清空重置，本次「下一場」操作已自動取消！';
      }

      const remoteActive = remoteState.players.filter(p => p.status === 'active');
      const getRemoteName = id => (remoteState.players.find(p => p.id === id) || {}).name || '未知';

      if (!remoteState.currentMatch) {
        if (remoteActive.length < 4) {
          return '在場人數不足 4 人，無法安排雙打比賽！';
        }
        const firstMatch = pickFourPlayers(remoteActive, remoteState.history);
        remoteState.currentMatch = { ...firstMatch, matchNumber: 1 };
        remoteState.upcomingMatch = generateUpcomingMatch(
          remoteState.currentMatch,
          remoteState.players,
          remoteState.history
        );
        return remoteState;
      }

      const currentIds = [...remoteState.currentMatch.teamA, ...remoteState.currentMatch.teamB];
      remoteState.players.forEach(p => {
        if (currentIds.includes(p.id)) {
          p.played = (p.played || 0) + 1;
          p.consecutivePlay = (p.consecutivePlay || 0) + 1;
          p.consecutiveRest = 0;
        } else if (p.status === 'active') {
          p.consecutivePlay = 0;
          p.consecutiveRest = (p.consecutiveRest || 0) + 1;
        }
      });

      remoteState.history.push({
        matchNumber: remoteState.currentMatch.matchNumber || (remoteState.history.length + 1),
        teamAIds: [...remoteState.currentMatch.teamA],
        teamBIds: [...remoteState.currentMatch.teamB],
        teamANames: [getRemoteName(remoteState.currentMatch.teamA[0]), getRemoteName(remoteState.currentMatch.teamA[1])],
        teamBNames: [getRemoteName(remoteState.currentMatch.teamB[0]), getRemoteName(remoteState.currentMatch.teamB[1])],
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      });

      if (remoteActive.length < 4) {
        remoteState.currentMatch = null;
        remoteState.upcomingMatch = null;
        postMessage = '本場已結算並寫入紀錄！但目前在場人數不足 4 人，已暫停自動排賽。';
        return remoteState;
      }

      let nextMatch = remoteState.upcomingMatch;
      const validNext = nextMatch && [...nextMatch.teamA, ...nextMatch.teamB].every(id =>
        remoteActive.some(p => p.id === id)
      );

      if (!validNext) {
        nextMatch = pickFourPlayers(remoteActive, remoteState.history);
      }

      remoteState.currentMatch = {
        ...nextMatch,
        matchNumber: (remoteState.history.length || 0) + 1
      };
      remoteState.upcomingMatch = generateUpcomingMatch(
        remoteState.currentMatch,
        remoteState.players,
        remoteState.history
      );

      return remoteState;
    }, () => {
      if (postMessage) alert(postMessage);
    });
  };

  const openSwapModal = () => {
    if (!state.currentMatch) return;
    if (activePlayers.length <= 1) {
      alert('目前沒有其他在場球員可供替換或調整！');
      return;
    }

    const currentIds = [...state.currentMatch.teamA, ...state.currentMatch.teamB];
    const defaultOut = currentIds[0];
    const candidates = activePlayers.filter(p => p.id !== defaultOut);

    setSwapOutId(defaultOut);
    setSwapInId(candidates[0]?.id || '');
    setShowSwapModal(true);
  };

  const handleSwapOutChange = (newOutId) => {
    setSwapOutId(newOutId);
    const candidates = activePlayers.filter(p => p.id !== newOutId);
    setSwapInId(candidates[0]?.id || '');
  };

  const confirmSwap = () => {
    if (!swapOutId || !swapInId || swapOutId === swapInId) return;

    commitStateChange(roomId, (remoteState) => {
      if (!remoteState.currentMatch) {
        return '目前場上已無進行中的比賽，無法替換！';
      }

      let { teamA, teamB } = remoteState.currentMatch;
      const isInOnCourt = teamA.includes(swapInId) || teamB.includes(swapInId);

      if (isInOnCourt) {
        const swapTwoIds = arr => arr.map(id => {
          if (id === swapOutId) return swapInId;
          if (id === swapInId) return swapOutId;
          return id;
        });
        teamA = swapTwoIds(teamA);
        teamB = swapTwoIds(teamB);
      } else {
        if (teamA.includes(swapOutId)) {
          teamA = teamA.map(id => id === swapOutId ? swapInId : id);
        } else {
          teamB = teamB.map(id => id === swapOutId ? swapInId : id);
        }
      }

      remoteState.currentMatch.teamA = teamA;
      remoteState.currentMatch.teamB = teamB;
      remoteState.upcomingMatch = generateUpcomingMatch(
        remoteState.currentMatch,
        remoteState.players,
        remoteState.history
      );
      return remoteState;
    }, () => {
      setShowSwapModal(false);
    });
  };

  const openEndSessionModal = () => {
    if (!state.isRosterLocked) {
      alert('⚠️ 名單尚在編輯中，請先點擊「儲存名冊」鎖定後，再進行清空結算！');
      setIsRosterExpanded(true);
      return;
    }
    setShowEndModal(true);
  };

  const executeEndAllMatches = () => {
    commitStateChange(roomId, (remoteState) => {
      if (!remoteState.isRosterLocked) {
        return '⚠️ 名單剛剛被其他管理員解鎖編輯中，已取消清空操作！';
      }
      const empty = createEmptyState();
      empty.version = remoteState.version;
      return empty;
    }, () => {
      setRosterText('');
      setShowEndModal(false);
    });
  };

  const copyShareLink = () => {
    navigator.clipboard.writeText(window.location.href).then(() => {
      alert('已複製此看板網址！直接貼到 LINE 群組，大家點開就能看到即時排程。');
    });
  };

  const isPlaying = Boolean(state.currentMatch);
  const currentCourtIds = isPlaying ? [...state.currentMatch.teamA, ...state.currentMatch.teamB] : [];
  const restingPlayers = activePlayers.filter(p => !currentCourtIds.includes(p.id));
  const sortedHistory = [...(state.history || [])].sort((a, b) => (a.matchNumber || 0) - (b.matchNumber || 0));

  const swapOutOptions = currentCourtIds.map(id => players.find(p => p.id === id)).filter(Boolean);
  const swapInCandidates = activePlayers.filter(p => p.id !== swapOutId);
  const benchCandidates = swapInCandidates.filter(p => !currentCourtIds.includes(p.id));
  const courtCandidates = swapInCandidates.filter(p => currentCourtIds.includes(p.id));

  return (
    <div>
      <header className="bg-green-600 text-white shadow-md sticky top-0 z-40">
        <div className="max-w-4xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center space-x-2">
            <i className="fa-solid fa-feather text-xl"></i>
            <h1 className="font-bold text-lg tracking-wide">羽球對戰即時看板</h1>
          </div>
          <div className="flex items-center space-x-2">
            <span className="text-xs bg-green-700 px-2 py-1 rounded-full border border-green-400 flex items-center space-x-1">
              <span className="w-2 h-2 rounded-full bg-green-300"></span>
              <span>{isSynced ? '即時同步中' : '連線中'}</span>
            </span>
            <button
              onClick={copyShareLink}
              className="bg-green-700 hover:bg-green-800 text-xs px-2.5 py-1.5 rounded-lg flex items-center space-x-1 font-medium shadow-sm transition"
            >
              <i className="fa-solid fa-share-nodes"></i>
              <span>分享</span>
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-4 mt-4 space-y-5">
        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
          <div className="bg-gray-50 border-b border-gray-200 px-4 py-3 flex justify-between items-center">
            <div className="flex items-center space-x-2">
              <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
              <h2 className="font-bold text-gray-700 text-base">目前賽況</h2>
              <span
                className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                  isPlaying ? 'bg-green-100 text-green-700 font-bold' : 'bg-gray-100 text-gray-500'
                }`}
              >
                {isPlaying ? `第 ${state.currentMatch.matchNumber} 場進行中` : '準備就緒'}
              </span>
            </div>
            {isPlaying && (
              <div className="flex space-x-2">
                <button
                  onClick={openSwapModal}
                  className="text-xs bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold px-3 py-1.5 rounded-lg transition"
                >
                  替換球員
                </button>
              </div>
            )}
          </div>

          <div className="p-5">
            {isPlaying ? (
              <div>
                <div className="bg-green-800 rounded-xl p-4 text-white relative shadow-inner">
                  <div className="grid grid-cols-2 gap-4 relative">
                    <div className="court-net"></div>

                    <div className="bg-green-900 bg-opacity-60 p-3 rounded-lg flex flex-col items-center justify-center min-h-24 border border-green-700">
                      <div className="text-xs text-green-300 font-semibold mb-1">組合 A</div>
                      <div className="text-lg md:text-xl font-black tracking-wide text-center">
                        {`${getName(state.currentMatch.teamA[0])}  &  ${getName(state.currentMatch.teamA[1])}`}
                      </div>
                    </div>

                    <div className="bg-green-900 bg-opacity-60 p-3 rounded-lg flex flex-col items-center justify-center min-h-24 border border-green-700">
                      <div className="text-xs text-green-300 font-semibold mb-1">組合 B</div>
                      <div className="text-lg md:text-xl font-black tracking-wide text-center">
                        {`${getName(state.currentMatch.teamB[0])}  &  ${getName(state.currentMatch.teamB[1])}`}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-3 flex items-center space-x-2 text-xs text-gray-500 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                  <i className="fa-solid fa-mug-hot text-yellow-500"></i>
                  <span className="font-bold">本場輪休：</span>
                  <span className="text-gray-700 font-medium">
                    {restingPlayers.length > 0 ? restingPlayers.map(p => p.name).join('、') : '無人輪休'}
                  </span>
                </div>
              </div>
            ) : (
              <div className="py-10 text-center">
                <i className="fa-solid fa-people-arrows text-3xl text-gray-300 mb-2"></i>
                <p className="text-gray-500 text-sm font-medium">尚未開賽，請點擊下方按鈕開始第一場</p>
              </div>
            )}

            {state.upcomingMatch && (
              <div className="mt-4 p-4 rounded-xl border border-blue-200 bg-blue-50/60">
                <div className="flex items-center space-x-2 mb-2">
                  <i className="fa-solid fa-forward text-blue-600 text-sm"></i>
                  <h3 className="text-sm font-bold text-blue-900">下一場預排陣容</h3>
                  <span className="text-[11px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">即時聯動</span>
                </div>

                <div className="bg-white rounded-lg p-3 border border-blue-100 relative shadow-sm">
                  <div className="grid grid-cols-2 gap-4 relative">
                    <div className="court-net-sub"></div>
                    <div className="text-center p-2">
                      <div className="text-[11px] text-gray-400 font-semibold mb-0.5">預定 A 組</div>
                      <div className="text-base font-bold text-gray-800">
                        {`${getName(state.upcomingMatch.teamA[0])}  &  ${getName(state.upcomingMatch.teamA[1])}`}
                      </div>
                    </div>
                    <div className="text-center p-2">
                      <div className="text-[11px] text-gray-400 font-semibold mb-0.5">預定 B 組</div>
                      <div className="text-base font-bold text-gray-800">
                        {`${getName(state.upcomingMatch.teamB[0])}  &  ${getName(state.upcomingMatch.teamB[1])}`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <button
              onClick={handleFinishAndNext}
              className={`mt-4 w-full py-3.5 rounded-xl font-bold flex items-center justify-center space-x-2 shadow-sm transition text-white ${
                isPlaying ? 'bg-yellow-500 hover:bg-yellow-600' : 'bg-green-600 hover:bg-green-700'
              }`}
            >
              <i className={`fa-solid ${isPlaying ? 'fa-forward-step' : 'fa-play'}`}></i>
              <span>{isPlaying ? '完成本場並進入下一場' : '開始第一場賽事'}</span>
            </button>
          </div>
        </section>

        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <div className="flex justify-between items-center mb-3">
            <div>
              <h2 className="font-bold text-gray-800 text-base">球員名冊與出勤管理</h2>
              <p className="text-xs text-gray-400">表格名稱可直接編輯改名，失焦或按 Enter 儲存</p>
            </div>
            <button
              onClick={() => setIsRosterExpanded(!isRosterExpanded)}
              className="text-xs bg-gray-100 hover:bg-gray-200 text-gray-600 px-3 py-1.5 rounded-lg font-medium transition flex items-center space-x-1"
            >
              <i className={`fa-solid ${isRosterExpanded ? 'fa-chevron-up' : 'fa-chevron-down'}`}></i>
              <span>{isRosterExpanded ? '收合批次輸入框' : '展開批次輸入框'}</span>
            </button>
          </div>

          {isRosterExpanded && (
            <div className="mb-4 p-3 bg-gray-50 rounded-xl border border-gray-200">
              <div className="flex justify-between items-center mb-1">
                <label className="block text-xs font-semibold text-gray-500">球員名單批次編輯（一行一位）：</label>
                <span
                  className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                    state.isRosterLocked ? 'bg-gray-200 text-gray-600' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  <i className={`fa-solid ${state.isRosterLocked ? 'fa-lock' : 'fa-unlock'} text-[10px] mr-1`}></i>
                  {state.isRosterLocked ? '已鎖定' : '編輯中'}
                </span>
              </div>
              <textarea
                rows="5"
                disabled={state.isRosterLocked}
                value={rosterText}
                onChange={(e) => setRosterText(e.target.value)}
                placeholder={"請在此輸入名單，一行一人\n王小明\n李小美\n陳大華\n張志豪"}
                className={`w-full text-sm font-medium p-2.5 border rounded-lg focus:outline-none transition ${
                  state.isRosterLocked
                    ? 'bg-gray-100 border-gray-300 text-gray-500 cursor-not-allowed'
                    : 'bg-white border-green-500 ring-2 ring-green-100 text-gray-800 cursor-text'
                }`}
              ></textarea>
              <div className="mt-2 flex justify-between items-center">
                <span className="text-xs text-gray-400">
                  {state.isRosterLocked ? '點擊右側「批次編輯名冊」以大批增減成員' : '修改完畢後請點擊「儲存名冊」'}
                </span>
                <button
                  onClick={handleRosterButtonClick}
                  className={`text-xs px-4 py-1.5 rounded-lg font-semibold shadow-sm transition flex items-center space-x-1 text-white ${
                    state.isRosterLocked ? 'bg-gray-700 hover:bg-gray-800' : 'bg-green-600 hover:bg-green-700'
                  }`}
                >
                  <i className={`fa-solid ${state.isRosterLocked ? 'fa-pen-to-square' : 'fa-check'} mr-1`}></i>
                  <span>{state.isRosterLocked ? '批次編輯名冊' : '儲存名冊'}</span>
                </button>
              </div>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100 pb-2">
                  <th className="py-2 font-medium w-1/3">球員名稱 (點擊改名)</th>
                  <th className="py-2 font-medium text-center">已出賽</th>
                  <th className="py-2 font-medium text-center">連打</th>
                  <th className="py-2 font-medium text-center">連休</th>
                  <th className="py-2 font-medium text-right">出勤狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {players.length === 0 ? (
                  <tr>
                    <td colSpan="5" className="py-6 text-center text-gray-400 text-xs">
                      尚無球員，請在上方輸入框輸入名單（一行一人），點擊「儲存名冊」即可建立。
                    </td>
                  </tr>
                ) : (
                  players.map((p) => {
                    const isActive = p.status === 'active';
                    return (
                      <tr key={p.id} className="hover:bg-gray-50 transition">
                        <td className="py-2">
                          <input
                            type="text"
                            defaultValue={p.name}
                            key={`${p.id}-${p.name}`}
                            onBlur={(e) => updatePlayerName(p.id, e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') e.target.blur();
                            }}
                            className="w-full max-w-[150px] font-bold text-gray-800 px-2 py-1 rounded-md border border-transparent hover:border-gray-300 focus:border-green-500 focus:bg-white focus:outline-none transition bg-transparent"
                          />
                        </td>
                        <td className="py-2 text-center font-bold text-green-600">{p.played || 0}</td>
                        <td className="py-2 text-center">
                          {(p.consecutivePlay || 0) > 0 ? (
                            <span className="bg-amber-100 text-amber-800 font-bold px-2 py-0.5 rounded-full text-xs">
                              {p.consecutivePlay}
                            </span>
                          ) : (
                            <span className="text-gray-300">0</span>
                          )}
                        </td>
                        <td className="py-2 text-center">
                          {(p.consecutiveRest || 0) > 0 ? (
                            <span className="bg-blue-100 text-blue-800 font-bold px-2 py-0.5 rounded-full text-xs">
                              {p.consecutiveRest}
                            </span>
                          ) : (
                            <span className="text-gray-300">0</span>
                          )}
                        </td>
                        <td className="py-2 text-right">
                          <select
                            value={p.status}
                            onChange={(e) => changePlayerStatus(p.id, e.target.value)}
                            className={`text-xs font-bold px-2 py-1 rounded-lg border focus:outline-none ${
                              isActive
                                ? 'bg-green-50 text-green-700 border-green-200'
                                : 'bg-gray-100 text-gray-600 border-gray-300'
                            }`}
                          >
                            <option value="active">🟢 在場</option>
                            <option value="absent">⚪ 不在場</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 pt-3 border-t border-gray-100 flex justify-between items-center text-xs">
            <span className="text-gray-400">{`在場球員: ${activePlayers.length} 人 / 總球員: ${players.length} 人`}</span>
          </div>
        </section>

        <div className="pt-1 pb-1">
          <button
            onClick={openEndSessionModal}
            className="w-full bg-red-600 hover:bg-red-700 active:bg-red-800 text-white py-3.5 rounded-2xl font-bold flex items-center justify-center space-x-2 shadow-md transition active:scale-[0.99]"
          >
            <i className="fa-solid fa-circle-stop text-lg text-white"></i>
            <span className="text-base tracking-wide">完成所有比賽 (清空結算)</span>
          </button>
        </div>

        <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-5">
          <div className="flex justify-between items-center mb-3">
            <div className="flex items-center space-x-2">
              <i className="fa-solid fa-clock-rotate-left text-green-600"></i>
              <h2 className="font-bold text-gray-800 text-base">已對戰組合紀錄</h2>
            </div>
            <span className="text-xs text-gray-400">{`共 ${sortedHistory.length} 場`}</span>
          </div>

          <div className="space-y-2">
            {sortedHistory.length === 0 ? (
              <div className="py-6 text-center text-gray-400 text-xs">尚無任何已完成的對戰紀錄</div>
            ) : (
              sortedHistory.map((h, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center space-x-2">
                    <span className="bg-gray-200 text-gray-700 font-bold px-2 py-0.5 rounded-md text-[11px]">
                      第 {h.matchNumber} 場
                    </span>
                    <span className="text-gray-400 text-[11px]">{h.time}</span>
                  </div>
                  <div className="font-bold text-gray-800">
                    <span className="text-green-700">{h.teamANames.join(' & ')}</span>
                    <span className="mx-2 text-gray-400 font-normal">VS</span>
                    <span className="text-blue-700">{h.teamBNames.join(' & ')}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </main>

      {showSwapModal && isPlaying && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-2xl p-5 shadow-2xl">
            <h3 className="text-base font-bold text-gray-800 mb-2">替換 / 調整場上球員</h3>
            <p className="text-xs text-gray-500 mb-4 leading-relaxed">
              可選擇換上<strong>場下休息</strong>球員，或直接與<strong>場上其他球員</strong>對調位置打亂搭檔（不會提前結算場次）：
            </p>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">換下 / 調整（目前場上 4 人）：</label>
                <select
                  value={swapOutId}
                  onChange={(e) => handleSwapOutChange(e.target.value)}
                  className="w-full text-sm p-2 rounded-lg border border-gray-300 bg-white"
                >
                  {swapOutOptions.map((p) => {
                    const teamLabel = state.currentMatch.teamA.includes(p.id) ? '組合 A' : '組合 B';
                    return (
                      <option key={p.id} value={p.id}>
                        {`${p.name}（目前：${teamLabel}）`}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-500 block mb-1">換上 / 對調（其餘在場球員）：</label>
                <select
                  value={swapInId}
                  onChange={(e) => setSwapInId(e.target.value)}
                  className="w-full text-sm p-2 rounded-lg border border-gray-300 bg-white"
                >
                  {benchCandidates.length > 0 && (
                    <optgroup label="場下休息球員（替換上場）">
                      {benchCandidates.map((p) => (
                        <option key={p.id} value={p.id}>
                          {`${p.name}（場下休息）`}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {courtCandidates.length > 0 && (
                    <optgroup label="場上其他球員（互換位置 / 換搭檔）">
                      {courtCandidates.map((p) => {
                        const teamLabel = state.currentMatch.teamA.includes(p.id) ? '組合 A' : '組合 B';
                        return (
                          <option key={p.id} value={p.id}>
                            {`${p.name}（場上互換 - ${teamLabel}）`}
                          </option>
                        );
                      })}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>

            <div className="mt-5 flex justify-end space-x-2">
              <button
                onClick={() => setShowSwapModal(false)}
                className="px-3 py-1.5 text-xs font-semibold text-gray-500 bg-gray-100 rounded-lg"
              >
                取消
              </button>
              <button
                onClick={confirmSwap}
                className="px-3 py-1.5 text-xs font-semibold text-white bg-green-600 rounded-lg hover:bg-green-700"
              >
                確認替換並聯動預排
              </button>
            </div>
          </div>
        </div>
      )}

      {showEndModal && (
        <div className="fixed inset-0 bg-black bg-opacity-40 z-50 flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-xs rounded-2xl p-5 shadow-2xl text-center">
            <i className="fa-solid fa-flag-checkered text-red-500 text-3xl mb-2"></i>
            <h3 className="text-base font-bold text-gray-800">結束並完成所有比賽？</h3>
            <p className="text-xs text-gray-500 mt-2 mb-4 leading-relaxed">
              確認後將代表今日打球活動結束，<br />
              <span className="text-red-600 font-bold">球員名冊、場上賽況與對戰紀錄</span>將全數清空。
            </p>
            <div className="flex justify-center space-x-2">
              <button
                onClick={executeEndAllMatches}
                className="px-4 py-1.5 text-xs font-semibold text-white bg-green-600 hover:bg-green-700 active:bg-green-800 rounded-lg shadow-sm transition"
              >
                確認全部清空
              </button>
              <button
                onClick={() => setShowEndModal(false)}
                className="px-4 py-1.5 text-xs font-semibold text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg transition"
              >
                取消
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;