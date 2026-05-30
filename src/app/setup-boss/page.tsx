'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SetupBossPage() {
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [passcode, setPasscode] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState({ type: '', text: '' });
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMsg({ type: '', text: '' });

    try {
      const res = await fetch('/api/setup-boss', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, username, password, passcode })
      });
      const data = await res.json();

      if (!res.ok) {
        setMsg({ type: 'error', text: data.error || '创建失败' });
      } else {
        setMsg({ type: 'success', text: '✅ 创建成功！对方现在可以直接登录控制台了。' });
        setName('');
        setUsername('');
        setPassword('');
      }
    } catch (err) {
      setMsg({ type: 'error', text: '网络请求失败' });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6', fontFamily: 'sans-serif' }}>
      <div style={{ backgroundColor: '#fff', padding: '40px', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', width: '100%', maxWidth: '400px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', color: '#111827', marginBottom: '8px', textAlign: 'center' }}>添加老板账号</h1>
        <p style={{ fontSize: '14px', color: '#6b7280', marginBottom: '24px', textAlign: 'center' }}>这是一个隐藏的安全创建页面</p>
        
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>
            <label style={{ display: 'block', fontSize: '14px', color: '#374151', marginBottom: '4px' }}>老板姓名</label>
            <input required value={name} onChange={e => setName(e.target.value)} placeholder="如：李总" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '14px', color: '#374151', marginBottom: '4px' }}>登录账号</label>
            <input required value={username} onChange={e => setUsername(e.target.value)} placeholder="用于登录控制台的账号" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none' }} />
          </div>
          <div>
            <label style={{ display: 'block', fontSize: '14px', color: '#374151', marginBottom: '4px' }}>登录密码</label>
            <input required type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="设置初始密码" minLength={6} style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #d1d5db', outline: 'none' }} />
          </div>
          <div style={{ marginTop: '8px', paddingTop: '16px', borderTop: '1px dashed #e5e7eb' }}>
            <label style={{ display: 'block', fontSize: '14px', color: '#ef4444', marginBottom: '4px', fontWeight: 'bold' }}>安全授权码 (防止外人创建)</label>
            <input required type="password" value={passcode} onChange={e => setPasscode(e.target.value)} placeholder="请输入授权码" style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #fca5a5', outline: 'none' }} />
          </div>

          {msg.text && (
            <div style={{ padding: '12px', borderRadius: '6px', fontSize: '14px', backgroundColor: msg.type === 'error' ? '#fee2e2' : '#dcfce3', color: msg.type === 'error' ? '#991b1b' : '#166534', textAlign: 'center' }}>
              {msg.text}
            </div>
          )}

          <button disabled={loading} type="submit" style={{ width: '100%', padding: '12px', backgroundColor: '#2563eb', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '16px', fontWeight: 'bold', cursor: loading ? 'not-allowed' : 'pointer', marginTop: '8px', opacity: loading ? 0.7 : 1 }}>
            {loading ? '正在创建...' : '立即创建老板账号'}
          </button>
          
          <button type="button" onClick={() => router.push('/')} style={{ width: '100%', padding: '12px', backgroundColor: 'transparent', color: '#4b5563', border: '1px solid #d1d5db', borderRadius: '6px', fontSize: '14px', cursor: 'pointer' }}>
            返回登录页
          </button>
        </form>
      </div>
    </div>
  );
}
