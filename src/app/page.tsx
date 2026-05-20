'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

type LoginResponse = { message: string; user: { id: string; companyId: string; role: 'boss' | 'staff'; username: string; name: string | null } } | { error: string };

export default function HomePage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (localStorage.getItem('partnerx_user')) router.replace('/dashboard');
  }, [router]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json() as LoginResponse;
      if (!res.ok) {
        setError('error' in data ? data.error : '登录失败');
        return;
      }
      if ('user' in data) {
        localStorage.setItem('partnerx_user', JSON.stringify(data.user));
        router.push('/dashboard');
      }
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="loginPage">
      <div className="loginBox">
        <h1 className="loginBrand">PARTNERX</h1>
        <p className="loginSubtitle">伙伴增长控制台</p>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>账号</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="请输入账号" required />
          </label>
          <label className="field">
            <span>密码</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="请输入密码" required />
          </label>
          {error && <p className="loginError">{error}</p>}
          <button className="submitBtn" type="submit" disabled={loading}>
            {loading ? '登录中...' : '登录'}
          </button>
        </form>
      </div>
    </main>
  );
}
