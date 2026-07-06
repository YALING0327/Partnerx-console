'use client';

import { useCallback, useEffect, useState } from 'react';
import { t, type Lang } from '@/lib/i18n';
import { authPayload, type StoredUser } from '../types';
import { genderText, postJson } from '../utils';

type ChatEmployee = { employeeId: string; name: string; inviteCode: string; inviterId: string; status: string };
type ChatSession = { peerId: string; nickname: string; country: string; gender: string; firstRecharge: string; lastTime: string; lastText: string; msgCount: number };
type ChatMessage = { dir: 'out' | 'in'; text: string; kind: string; imageUrl?: string; violation: string | 0; time: string };
type ChatPeer = { peerId: string; nickname: string; country: string; gender: string; firstRecharge: string };

export default function ChatView({ user, lang }: { user: StoredUser; lang: Lang }) {
  const auth = authPayload(user);

  const [employees, setEmployees] = useState<ChatEmployee[]>([]);
  const [activeEmp, setActiveEmp] = useState<ChatEmployee | null>(null);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activePeer, setActivePeer] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peerInfo, setPeerInfo] = useState<ChatPeer | null>(null);
  const [days, setDays] = useState(30);

  const [loadingEmp, setLoadingEmp] = useState(true);
  const [loadingSess, setLoadingSess] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState(false);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');

  // 翻译：autoTrans 开关 + 已翻译的译文(按消息索引缓存) + 翻译中状态
  const [autoTrans, setAutoTrans] = useState(false);
  const [trans, setTrans] = useState<Record<number, string>>({});
  const [transLoading, setTransLoading] = useState(false);

  // 翻译当前会话里需要翻译的消息（文本、非中文、未翻译过）
  const translateMessages = useCallback(async (msgs: ChatMessage[]) => {
    const idxs = msgs
      .map((m, i) => ({ m, i }))
      .filter(({ m }) => (m.kind === 'text' || m.kind === 'other') && m.text && !/^[一-龥\s\d\p{P}]+$/u.test(m.text));
    if (idxs.length === 0) return;
    setTransLoading(true);
    try {
      const json = await postJson('/api/chat/translate', { ...auth, texts: idxs.map(({ m }) => m.text), target: 'zh-CN' });
      if (Array.isArray(json.translations)) {
        setTrans((prev) => {
          const next = { ...prev };
          idxs.forEach(({ i }, k) => { next[i] = json.translations[k]; });
          return next;
        });
      }
    } catch { /* 忽略翻译失败 */ }
    finally { setTransLoading(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 1) 加载可见师傅列表
  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingEmp(true); setErr('');
      try {
        const json = await postJson('/api/chat/employees', auth);
        if (json.error) throw new Error(json.error || '加载失败');
        if (!alive) return;
        setEmployees(json.employees || []);
        if ((json.employees || []).length > 0) setActiveEmp(json.employees[0]);
      } catch (e: any) { if (alive) setErr(e.message); }
      finally { if (alive) setLoadingEmp(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2) 选定师傅 → 加载对话用户列表
  useEffect(() => {
    if (!activeEmp) return;
    let alive = true;
    (async () => {
      setLoadingSess(true); setErr(''); setSessions([]); setActivePeer(null); setMessages([]); setPeerInfo(null);
      try {
        const json = await postJson('/api/chat/sessions', { ...auth, inviterId: activeEmp.inviterId, days });
        if (json.error) throw new Error(json.error || '加载失败');
        if (!alive) return;
        setSessions(json.sessions || []);
      } catch (e: any) { if (alive) setErr(e.message); }
      finally { if (alive) setLoadingSess(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEmp, days]);

  // 3) 选定对话用户 → 加载完整对话
  useEffect(() => {
    if (!activeEmp || !activePeer) return;
    let alive = true;
    (async () => {
      setLoadingMsg(true); setErr(''); setMessages([]); setTrans({});
      try {
        const json = await postJson('/api/chat/messages', { ...auth, inviterId: activeEmp.inviterId, peerId: activePeer.peerId, days });
        if (json.error) throw new Error(json.error || '加载失败');
        if (!alive) return;
        const msgs = json.messages || [];
        setMessages(msgs);
        setPeerInfo(json.peer || null);
        if (autoTrans) translateMessages(msgs);
      } catch (e: any) { if (alive) setErr(e.message); }
      finally { if (alive) setLoadingMsg(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePeer]);

  // 打开自动翻译时，翻译当前已加载的消息
  useEffect(() => {
    if (autoTrans && messages.length > 0) translateMessages(messages);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrans]);

  const filteredSessions = sessions.filter((s) =>
    !search.trim() || s.peerId.includes(search.trim()) || (s.nickname || '').toLowerCase().includes(search.trim().toLowerCase())
  );
  const peerNick = peerInfo?.nickname || activePeer?.nickname || '';

  return (
    <section className="chatWrap">
      <div className="chatToolbar">
        <span>{t(lang, 'chat_range')}：</span>
        <select className="langSelect" value={days} onChange={(e) => setDays(Number(e.target.value))}>
          <option value={7}>{t(lang, 'chat_7d')}</option>
          <option value={30}>{t(lang, 'chat_30d')}</option>
          <option value={90}>{t(lang, 'chat_90d')}</option>
        </select>
        {err && <span className="chatErr">{err}</span>}
      </div>

      <div className="chatLayout">
        {/* 左：师傅(账号)列表 */}
        <div className="chatCol chatEmps">
          <div className="chatColHead">{t(lang, 'chat_employees')}</div>
          <div className="chatColBody">
            {loadingEmp ? <div className="chatHint">{t(lang, 'loading')}</div>
              : employees.length === 0 ? <div className="chatHint">{t(lang, 'chat_no_emp')}</div>
              : employees.map((e) => (
                <button key={e.employeeId} className={`chatEmpItem${activeEmp?.employeeId === e.employeeId ? ' active' : ''}`} onClick={() => setActiveEmp(e)}>
                  <strong>{e.name}</strong>
                  <span>{e.inviteCode} · {e.inviterId}</span>
                </button>
              ))}
          </div>
        </div>

        {/* 中：对话用户列表 */}
        <div className="chatCol chatSessions">
          <div className="chatColHead">
            {t(lang, 'chat_sessions')}
            <input className="chatSearch" placeholder={t(lang, 'chat_search')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          <div className="chatColBody">
            {loadingSess ? <div className="chatHint">{t(lang, 'loading')}</div>
              : filteredSessions.length === 0 ? <div className="chatHint">{t(lang, 'chat_no_session')}</div>
              : filteredSessions.map((s) => (
                <button key={s.peerId} className={`chatSessItem${activePeer?.peerId === s.peerId ? ' active' : ''}`} onClick={() => setActivePeer(s)}>
                  <div className="chatSessTop">
                    <strong>{s.nickname || ('ID ' + s.peerId)}</strong>
                    <span className="chatSessTime">{(s.lastTime || '').slice(5, 16)}</span>
                  </div>
                  <div className="chatSessSub">
                    <span className="chatSessId">{s.peerId}</span>
                    <span className="chatSessPreview">{s.lastText}</span>
                  </div>
                  <span className="chatSessCount">{s.msgCount}</span>
                </button>
              ))}
          </div>
        </div>

        {/* 右：消息流 */}
        <div className="chatCol chatMessages">
          {!activePeer ? (
            <div className="chatEmptyMsg">{t(lang, 'chat_pick_user')}</div>
          ) : (
            <>
              <div className="chatMsgHead">
                <div className="chatPeerAvatar">{(peerNick || activePeer.peerId).slice(0, 1).toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <strong>{peerNick || ('ID ' + activePeer.peerId)}</strong>
                  <div className="chatPeerMeta">
                    {t(lang, 'chat_user_id')}: {activePeer.peerId}
                    {(peerInfo?.country || activePeer.country) && <> · {peerInfo?.country || activePeer.country}</>}
                    {' · '}{genderText(peerInfo?.gender || activePeer.gender, lang)}
                    {(peerInfo?.firstRecharge || activePeer.firstRecharge) && <> · {t(lang, 'chat_first_recharge')} {(peerInfo?.firstRecharge || activePeer.firstRecharge)}</>}
                  </div>
                </div>
                <label className="chatTransToggle">
                  <input type="checkbox" checked={autoTrans} onChange={(e) => setAutoTrans(e.target.checked)} />
                  {t(lang, 'chat_auto_translate')}{transLoading ? ' …' : ''}
                </label>
              </div>
              <div className="chatMsgBody">
                {loadingMsg ? <div className="chatHint">{t(lang, 'loading')}</div>
                  : messages.length === 0 ? <div className="chatHint">{t(lang, 'chat_no_msg')}</div>
                  : messages.map((m, i) => (
                    <div key={i} className={`chatRow ${m.dir}`}>
                      <div className={`chatBubble ${m.dir} ${m.kind}`}>
                        {m.kind === 'image' ? (
                          m.imageUrl ? (
                            <a href={m.imageUrl} target="_blank" rel="noreferrer">
                              <img className="chatImg" src={m.imageUrl} alt={lang === 'zh' ? '图片' : 'image'} loading="lazy" />
                            </a>
                          ) : (
                            <div className="chatText">【图片】</div>
                          )
                        ) : (
                          <div className="chatText">{m.text}</div>
                        )}
                        {trans[i] && trans[i] !== m.text ? (
                          <div className="chatTrans"><span className="tl">{t(lang, 'chat_translation')}</span>{trans[i]}</div>
                        ) : null}
                        <div className="chatTime">
                          {(m.time || '').slice(5, 19)}
                          {m.violation ? <span className="chatViol"> · {t(lang, 'chat_violation')}</span> : null}
                          {' · '}{m.dir === 'out' ? (activeEmp?.name || t(lang, 'chat_master')) : (peerNick || t(lang, 'chat_user'))}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
