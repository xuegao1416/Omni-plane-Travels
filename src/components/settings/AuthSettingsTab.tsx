/**
 * 用户认证设置标签页（邮箱 + 密码登录 / 验证码注册 / 忘记密码）
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useDialog } from '../shared/Dialog';
import { LogIn, LogOut, User, Loader, Mail, ArrowRight, KeyRound } from 'lucide-react';

type AuthView = 'login' | 'register' | 'forgot';

export default function AuthSettingsTab() {
  const { user, isLoading, isAuthenticated, logout, sendCode, login, register, resetPassword } = useAuthStore();
  const { DialogUI, alert: showAlert } = useDialog();

  const [view, setView] = useState<AuthView>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [codeSent, setCodeSent] = useState(false);
  const codeRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  useEffect(() => {
    if (codeSent && view !== 'login') codeRef.current?.focus();
  }, [codeSent, view]);

  const resetForm = useCallback(() => {
    setEmail(''); setPassword(''); setCode(''); setError(''); setCodeSent(false); setCountdown(0);
  }, []);

  const handleSendCode = useCallback(async () => {
    if (!email.trim()) { setError('请输入邮箱'); return; }
    setError(''); setSending(true);
    try {
      await sendCode(email.trim());
      setCodeSent(true);
      setCountdown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : '发送失败');
    } finally {
      setSending(false);
    }
  }, [email, sendCode]);

  const handleLogin = useCallback(async () => {
    if (!email.trim()) { setError('请输入邮箱'); return; }
    if (!password) { setError('请输入密码'); return; }
    setError(''); setSubmitting(true);
    try {
      const result = await login(email.trim(), password);
      if (!result.ok) setError(result.error || '登录失败');
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败');
    } finally {
      setSubmitting(false);
    }
  }, [email, password, login]);

  const handleRegister = useCallback(async () => {
    if (!email.trim()) { setError('请输入邮箱'); return; }
    if (!code.trim() || code.trim().length !== 6) { setError('请输入 6 位验证码'); return; }
    if (password.length < 6) { setError('密码至少 6 位'); return; }
    setError(''); setSubmitting(true);
    try {
      const result = await register(email.trim(), code.trim(), password);
      if (!result.ok) setError(result.error || '注册失败');
    } catch (err) {
      setError(err instanceof Error ? err.message : '注册失败');
    } finally {
      setSubmitting(false);
    }
  }, [email, code, password, register]);

  const handleResetPassword = useCallback(async () => {
    if (!email.trim()) { setError('请输入邮箱'); return; }
    if (!code.trim() || code.trim().length !== 6) { setError('请输入 6 位验证码'); return; }
    if (password.length < 6) { setError('密码至少 6 位'); return; }
    setError(''); setSubmitting(true);
    try {
      const result = await resetPassword(email.trim(), code.trim(), password);
      if (!result.ok) setError(result.error || '重置失败');
    } catch (err) {
      setError(err instanceof Error ? err.message : '重置失败');
    } finally {
      setSubmitting(false);
    }
  }, [email, code, password, resetPassword]);

  if (isLoading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--text-muted)' }}>
        <Loader size={20} className="animate-spin" style={{ marginRight: 8 }} />
        <span>检查登录状态...</span>
      </div>
    );
  }

  if (isAuthenticated) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', padding: '20px' }}>
        {DialogUI}
        <div style={{
          display: 'flex', alignItems: 'center', gap: '16px',
          padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
        }}>
          <div style={{
            width: '48px', height: '48px', borderRadius: '50%', background: 'var(--accent-dim)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <User size={24} color="var(--accent)" />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600' }}>{user?.username}</div>
            <div style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)' }}>{user?.email}</div>
          </div>
        </div>

        <div style={{
          padding: '16px', background: 'var(--bg-secondary)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--border)',
        }}>
          <h4 style={{ fontSize: 'var(--font-size-base)', fontWeight: '600', marginBottom: '12px' }}>已解锁功能</h4>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {['云存档 - 跨设备同步存档', '创意工坊 - 分享和下载世界包', '创意工坊 - 分享和下载人物预设'].map((text) => (
              <li key={text} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)' }}>
                <span style={{ color: 'var(--accent)' }}>✓</span>{text}
              </li>
            ))}
          </ul>
        </div>

        <button
          onClick={logout}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', padding: '12px',
            background: 'transparent', color: 'var(--danger)', border: '1px solid var(--danger)',
            borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-base)', fontWeight: '600',
            cursor: 'pointer', transition: 'all 0.2s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--danger)'; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--danger)'; }}
        >
          <LogOut size={18} />登出
        </button>
      </div>
    );
  }

  // 未登录
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '40px 20px', maxWidth: '400px', margin: '0 auto' }}>
      {DialogUI}

      <div style={{
        width: '64px', height: '64px', borderRadius: '50%', background: 'var(--bg-tertiary)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <User size={32} color="var(--text-muted)" />
      </div>

      <div style={{ textAlign: 'center' }}>
        <h3 style={{ fontSize: 'var(--font-size-lg)', fontWeight: '600', marginBottom: '8px' }}>
          {view === 'login' ? '登录' : view === 'register' ? '注册' : '重置密码'}
        </h3>
        <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-muted)', marginBottom: '20px' }}>
          {view === 'login' ? '登录后可使用云存档和创意工坊功能' : view === 'register' ? '首次使用需要注册账号' : '通过验证码重置密码'}
        </p>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', width: '100%' }}>
        {/* 邮箱 */}
        <input
          className="input-field"
          type="email"
          value={email}
          onChange={e => { setEmail(e.target.value); setError(''); }}
          placeholder="邮箱地址"
          disabled={submitting}
          style={{ padding: '10px 12px' }}
        />

        {/* 密码（登录/注册/重置都显示） */}
        <input
          className="input-field"
          type="password"
          value={password}
          onChange={e => { setPassword(e.target.value); setError(''); }}
          placeholder={view === 'login' ? '密码' : '设置密码（至少 6 位）'}
          disabled={submitting}
          onKeyDown={e => e.key === 'Enter' && (view === 'login' ? handleLogin() : codeSent ? (view === 'register' ? handleRegister() : handleResetPassword()) : handleSendCode())}
          style={{ padding: '10px 12px' }}
        />

        {/* 验证码（注册/重置模式，发码后显示） */}
        {view !== 'login' && codeSent && (
          <input
            ref={codeRef}
            className="input-field"
            type="text"
            value={code}
            onChange={e => { setCode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError(''); }}
            placeholder="输入 6 位验证码"
            maxLength={6}
            disabled={submitting}
            style={{ padding: '10px 12px', letterSpacing: '6px', fontSize: 'var(--font-size-lg)', textAlign: 'center' }}
          />
        )}

        {error && <p style={{ color: 'var(--danger)', fontSize: 'var(--font-size-sm)', margin: 0 }}>{error}</p>}

        {/* 主按钮 */}
        {view === 'login' ? (
          <button
            onClick={handleLogin}
            disabled={submitting || !email.trim() || !password}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '12px', background: 'var(--accent, #d4af37)', color: '#000',
              border: 'none', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-base)', fontWeight: '600',
              cursor: submitting ? 'wait' : 'pointer', opacity: submitting || !email.trim() || !password ? 0.5 : 1,
            }}
          >
            {submitting ? <Loader size={16} className="animate-spin" /> : <LogIn size={16} />}
            登录
          </button>
        ) : !codeSent ? (
          <button
            onClick={handleSendCode}
            disabled={sending || !email.trim()}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '12px', background: 'var(--accent, #d4af37)', color: '#000',
              border: 'none', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-base)', fontWeight: '600',
              cursor: sending ? 'wait' : 'pointer', opacity: sending || !email.trim() ? 0.5 : 1,
            }}
          >
            {sending ? <Loader size={16} className="animate-spin" /> : <Mail size={16} />}
            发送验证码
          </button>
        ) : (
          <button
            onClick={view === 'register' ? handleRegister : handleResetPassword}
            disabled={submitting || code.length !== 6 || password.length < 6}
            style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
              padding: '12px', background: 'var(--accent, #d4af37)', color: '#000',
              border: 'none', borderRadius: 'var(--radius-md)', fontSize: 'var(--font-size-base)', fontWeight: '600',
              cursor: submitting ? 'wait' : 'pointer',
              opacity: submitting || code.length !== 6 || password.length < 6 ? 0.5 : 1,
            }}
          >
            {submitting ? <Loader size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            {view === 'register' ? '注册' : '重置密码'}
          </button>
        )}

        {/* 发码后的重发 */}
        {view !== 'login' && codeSent && (
          <div style={{ display: 'flex', justifyContent: 'center', gap: '16px' }}>
            <button
              onClick={handleSendCode}
              disabled={countdown > 0}
              style={{
                background: 'none', border: 'none', color: 'var(--accent, #d4af37)',
                fontSize: 'var(--font-size-sm)', cursor: 'pointer', opacity: countdown > 0 ? 0.5 : 1,
              }}
            >
              {countdown > 0 ? `${countdown}秒后可重发` : '重新发送'}
            </button>
          </div>
        )}

        {/* 切换视图 */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', marginTop: '8px' }}>
          {view === 'login' ? (
            <>
              <button onClick={() => { resetForm(); setView('register'); }} style={{ background: 'none', border: 'none', color: 'var(--accent, #d4af37)', fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}>
                注册账号
              </button>
              <button onClick={() => { resetForm(); setView('forgot'); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}>
                忘记密码
              </button>
            </>
          ) : (
            <button onClick={() => { resetForm(); setView('login'); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 'var(--font-size-sm)', cursor: 'pointer' }}>
              ← 返回登录
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
