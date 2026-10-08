import { useEffect, useState } from 'react';
import { NavLink, Link, Outlet } from 'react-router-dom';
import { HomeIcon, ListIcon, WalletIcon, BellIcon, UserIcon } from './Icons';
import { ensurePushSubscription, watchPushSubscription } from '../lib/push';
import { refreshUnread, subscribeUnread } from '../lib/notifCount';
import { refreshSession, pingSession } from '../lib/api';
import { getToken, tokenExpiresAt } from '../lib/session';
import PushPrompt from './PushPrompt';

const tabs = [
  { to: '/', label: 'Inici', end: true, Icon: HomeIcon },
  { to: '/referrals', label: 'Referits', end: false, Icon: ListIcon },
  { to: '/wallet', label: 'Cartera', end: false, Icon: WalletIcon },
];

export default function Layout() {
  const [unread, setUnread] = useState(0);

  // Renova silenciosament la subscripció push (si l'usuari ja la tenia activada)
  // a cada obertura de la PWA, perquè les subscripcions no caduquin.
  useEffect(() => {
    ensurePushSubscription();
    watchPushSubscription();
  }, []);

  // Badge de notificacions no llegides: subscriu al recompte compartit,
  // refresca en obrir, al tornar a la pestanya i periòdicament.
  useEffect(() => {
    const unsubscribe = subscribeUnread(setUnread);
    refreshUnread();
    const onVisible = () => {
      if (document.visibilityState === 'visible') refreshUnread();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(refreshUnread, 60000);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, []);

  // Refresc silenciós de la sessió: renova el token (`auth-refresh`) quan és a
  // prop de caducar, en obrir l'app i al tornar-hi. Així un usuari actiu no es
  // desconnecta mai, però un dispositiu abandonat caduca igualment.
  useEffect(() => {
    const maybeRefresh = () => {
      if (!getToken()) return;
      const exp = tokenExpiresAt();
      const threshold = 7 * 24 * 60 * 60 * 1000; // 7 dies
      if (exp == null || exp - Date.now() < threshold) refreshSession();
    };
    maybeRefresh();
    const onVisible = () => {
      if (document.visibilityState === 'visible') maybeRefresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);

  // Marca l'última obertura de l'app per al recordatori de re-engagement.
  // Com a màxim un cop cada 6h (suficient; evita crides en canvis de pestanya).
  useEffect(() => {
    const KEY = 'polser.lastPing';
    try {
      const last = Number(localStorage.getItem(KEY) || 0);
      if (last && Date.now() - last < 6 * 60 * 60 * 1000) return;
      localStorage.setItem(KEY, String(Date.now()));
    } catch {
      /* localStorage no disponible: fem el ping igualment */
    }
    pingSession().catch(() => {
      /* no crític */
    });
  }, []);

  return (
    <div className="app-shell">
      {/* Capçalera (mòbil i escriptori) */}
      <header className="topnav">
        <Link className="brand" to="/" aria-label="Inici">
          <span className="brand-logo" aria-hidden="true">
            P
          </span>
          <span className="brand-text">
            <strong>POLSER SEGURETAT</strong>
            <span>Portal de Partners</span>
          </span>
        </Link>

        <nav className="topnav-links" aria-label="Navegació principal">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => (isActive ? 'topnav-link active' : 'topnav-link')}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="topnav-actions">
          <NavLink
            to="/notifications"
            className="icon-btn"
            aria-label="Notificacions"
            title="Notificacions"
          >
            <BellIcon />
            {unread > 0 && (
              <span className="notif-badge" aria-hidden="true">
                {unread > 99 ? '99+' : unread}
              </span>
            )}
          </NavLink>
          <NavLink to="/profile" className="icon-btn" aria-label="El meu perfil" title="El meu perfil">
            <UserIcon />
          </NavLink>
        </div>
      </header>

      {/* Avisa l'usuari que activi les notificacions si encara no ho ha fet */}
      <PushPrompt />

      <main className="page">
        <Outlet />
      </main>

      {/* Barra de navegació inferior fixa (mòbil) */}
      <nav className="bottomnav" aria-label="Navegació principal">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => (isActive ? 'bottomnav-item active' : 'bottomnav-item')}
          >
            <tab.Icon size={22} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}