'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getStoredLang, setStoredLang, t, type Lang } from '@/lib/i18n';

type LoginResponse = { message: string; user: { id: string; companyId: string; role: 'boss' | 'staff'; username: string; name: string | null } } | { error: string };

export default function HomePage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [lang, setLang] = useState<Lang>('zh');

  useEffect(() => {
    if (localStorage.getItem('partnerx_user')) router.replace('/dashboard');
  }, [router]);

  useEffect(() => {
    setLang(getStoredLang());
  }, []);

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
        setError('error' in data ? data.error : t(lang, 'login_failed'));
        return;
      }
      if ('user' in data) {
        localStorage.setItem('partnerx_user', JSON.stringify(data.user));
        router.push('/dashboard');
      }
    } catch {
      setError(t(lang, 'network_error'));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="loginPage">
      <div className="loginLang">
        <select
          className="langSelect"
          value={lang}
          onChange={(e) => {
            const next = (e.target.value === 'en' ? 'en' : 'zh') as Lang;
            setLang(next);
            setStoredLang(next);
          }}
          aria-label={t(lang, 'language')}
        >
          <option value="zh">{t(lang, 'lang_zh')}</option>
          <option value="en">{t(lang, 'lang_en')}</option>
        </select>
      </div>
      <div className="loginBox">
        <h1 className="loginBrand"><span>PARTNER</span>X</h1>
        <p className="loginSubtitle">{t(lang, 'login_title')}</p>
        <form onSubmit={handleSubmit}>
          <label className="field">
            <span>{t(lang, 'login_username')}</span>
            <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t(lang, 'login_username_placeholder')} required />
          </label>
          <label className="field">
            <span>{t(lang, 'login_password')}</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t(lang, 'login_password_placeholder')} required />
          </label>
          {error && <p className="loginError">{error}</p>}
          <button className="submitBtn" type="submit" disabled={loading}>
            {loading ? t(lang, 'login_loading') : t(lang, 'login_submit')}
          </button>
        </form>
      </div>
    </main>
  );
}
