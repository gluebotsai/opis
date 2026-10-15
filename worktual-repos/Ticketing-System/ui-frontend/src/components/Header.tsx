import React, { useState, useEffect, useRef } from 'react';
import { Bell, CircleHelp, ChevronRight, ChevronDown, Trash2, FileText, Menu } from 'lucide-react';
import { Notification } from '../types';
import { usePageTitle } from './layout/PageTitleContext';

interface HeaderProps {
  onNavigate: (view: string) => void;
  currentUser: { name: string; email: string; initials: string; role?: string; organizationName?: string };
  notifications?: Notification[];
  onMarkAsRead?: (id: string) => void;
  onMarkAllAsRead?: () => void;
  onClearAll?: () => void;
  onNotificationClick?: (notification: Notification) => void;
  onLogout?: () => void;
  onMenuClick?: () => void;
}

export default function Header({
  onNavigate,
  currentUser,
  notifications = [],
  onMarkAllAsRead,
  onClearAll,
  onNotificationClick,
  onLogout,
  onMenuClick,
}: HeaderProps) {
  const { title } = usePageTitle();
  const [showNotifications, setShowNotifications] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (notificationsRef.current && !notificationsRef.current.contains(target)) {
        setShowNotifications(false);
      }
      if (profileRef.current && !profileRef.current.contains(target)) {
        setShowProfile(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const unreadCount = notifications.filter((n) => !n.read).length;
  const roleLabel = (currentUser.role || 'agent').replace(/^\w/, (c) => c.toUpperCase());
  const orgLabel = currentUser.organizationName || 'Worktual';

  return (
    <header
      id="worktual-header"
      className="h-14 shrink-0 border-b border-neutral-200/80 bg-[#f3f4f6] text-neutral-900 flex items-center justify-between px-3 sm:px-6 select-none gap-2 sm:gap-3 pt-[env(safe-area-inset-top)]"
    >
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={onMenuClick}
          className="md:hidden inline-flex items-center justify-center min-h-11 min-w-11 p-2 text-neutral-500 hover:text-neutral-900 hover:bg-neutral-200/60 rounded-lg cursor-pointer"
          aria-label="Open menu"
        >
          <Menu className="h-5 w-5" />
        </button>
        <h1 className="text-lg sm:text-2xl font-semibold tracking-tight text-neutral-900 truncate">
          {title}
        </h1>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          id="header-kb-btn"
          type="button"
          className="hidden sm:flex p-2 text-neutral-500 hover:text-neutral-900 hover:bg-white rounded-lg border border-transparent hover:border-neutral-200 transition-all cursor-pointer"
          title="Knowledge Base"
          onClick={() => onNavigate('kb')}
        >
          <CircleHelp className="h-4 w-4" />
        </button>

        <div className="relative" ref={notificationsRef}>
          <button
            id="notification-bell-btn"
            type="button"
            className={`relative inline-flex items-center justify-center min-h-11 min-w-11 p-2 rounded-lg transition-all cursor-pointer border ${
              showNotifications
                ? 'text-neutral-900 bg-white border-neutral-200'
                : 'text-neutral-500 hover:text-neutral-900 hover:bg-white border-transparent hover:border-neutral-200'
            }`}
            onClick={() => {
              setShowNotifications(!showNotifications);
              setShowProfile(false);
            }}
            title="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 bg-black text-white text-[9px] font-extrabold h-4 min-w-4 px-1 rounded-full flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotifications && (
            <div
              id="notifications-popover"
              className="absolute right-0 mt-3 w-[min(20rem,calc(100vw-1.5rem))] bg-white border border-neutral-200 rounded-2xl shadow-lg z-50 text-neutral-900 text-xs overflow-hidden"
            >
              <div className="p-4 border-b border-neutral-200 flex items-center justify-between bg-neutral-50/80">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm tracking-tight">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="bg-neutral-100 text-neutral-600 text-[10px] px-2 py-0.5 rounded-full font-semibold border border-neutral-200">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                {unreadCount > 0 && onMarkAllAsRead && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onMarkAllAsRead();
                    }}
                    className="text-[10px] text-neutral-600 hover:text-black font-semibold transition-all cursor-pointer hover:underline"
                  >
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto p-2.5 space-y-1.5">
                {notifications.length > 0 ? (
                  notifications.map((notif) => (
                    <div
                      key={notif.id}
                      onClick={() => {
                        onNotificationClick?.(notif);
                        setShowNotifications(false);
                      }}
                      className={`p-3 flex items-start gap-3 rounded-xl transition-all cursor-pointer border ${
                        !notif.read
                          ? 'bg-neutral-50 border-neutral-200 hover:bg-neutral-100'
                          : 'bg-white border-transparent opacity-70 hover:opacity-100 hover:bg-neutral-50'
                      }`}
                    >
                      <div className="shrink-0 mt-1">
                        {!notif.read ? (
                          <span className="h-2.5 w-2.5 rounded-full bg-black block" />
                        ) : (
                          <span className="h-1.5 w-1.5 rounded-full bg-neutral-300 block ml-0.5" />
                        )}
                      </div>
                      <div className="flex-1 space-y-1 min-w-0">
                        <div className="flex items-center justify-between gap-1">
                          <span className="font-semibold text-neutral-900 text-xs">{notif.title}</span>
                          <span className="text-[10px] text-neutral-400 shrink-0">{notif.createdAt}</span>
                        </div>
                        <p className="text-neutral-500 text-[11px] leading-relaxed">{notif.message}</p>
                        {notif.ticketId && (
                          <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 bg-neutral-50 border border-neutral-200 text-neutral-600 rounded-lg text-[9px]">
                            <FileText className="h-2.5 w-2.5" />
                            <span>View Ticket {notif.ticketId}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="py-8 px-4 text-center text-neutral-400 flex flex-col items-center gap-2">
                    <Bell className="h-8 w-8 text-neutral-300 stroke-1" />
                    <p className="text-[11px] font-medium text-neutral-500">All caught up</p>
                  </div>
                )}
              </div>

              {notifications.length > 0 && (
                <div className="p-2.5 bg-neutral-50 border-t border-neutral-200 flex items-center justify-between text-[10px] text-neutral-500">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClearAll?.();
                    }}
                    className="flex items-center gap-1 hover:text-neutral-900 px-2 py-1 rounded transition-all cursor-pointer font-semibold"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Clear all</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowNotifications(false)}
                    className="hover:text-neutral-900 px-2 py-1 rounded font-semibold"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="relative" ref={profileRef}>
          <button
            id="user-profile-menu-btn"
            type="button"
            className="inline-flex items-center gap-2 min-h-11 h-11 px-2.5 sm:px-3 rounded-full border border-neutral-200 bg-white hover:border-neutral-300 transition-colors"
            onClick={() => {
              setShowProfile(!showProfile);
              setShowNotifications(false);
            }}
          >
            <div className="h-6 w-6 bg-neutral-900 text-white font-semibold text-[10px] flex items-center justify-center rounded-full">
              {currentUser.initials}
            </div>
            <span className="hidden sm:inline text-xs font-medium text-neutral-700">
              {roleLabel} · {orgLabel}
            </span>
            <ChevronDown className="hidden sm:block h-3.5 w-3.5 text-neutral-400" />
          </button>

          {showProfile && (
            <div
              id="user-profile-popover"
              className="absolute right-0 mt-3 w-60 bg-white border border-neutral-200 rounded-2xl shadow-lg z-50 text-neutral-900 p-5 flex flex-col items-center"
            >
              <div className="h-10 w-10 bg-neutral-900 text-white font-semibold text-base flex items-center justify-center rounded-full mb-2.5">
                {currentUser.initials}
              </div>
              <h4 className="font-semibold text-neutral-900 text-[13px] tracking-tight mb-1">
                {currentUser.name}
              </h4>
              <p className="text-[11px] text-neutral-500 mb-4 truncate max-w-full">{currentUser.email}</p>
              <div className="w-full border border-neutral-200 rounded-xl overflow-hidden bg-white shadow-sm">
                <button
                  type="button"
                  onClick={() => {
                    onNavigate('settings');
                    setShowProfile(false);
                  }}
                  className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-neutral-50 text-xs font-semibold text-neutral-800 cursor-pointer"
                >
                  <span>Account settings</span>
                  <ChevronRight className="h-4 w-4 text-neutral-400" />
                </button>
                <div className="border-t border-neutral-200" />
                <button
                  type="button"
                  onClick={() => {
                    onLogout?.();
                    setShowProfile(false);
                  }}
                  className="w-full px-4 py-3 text-left hover:bg-rose-50/40 text-xs font-semibold text-rose-600 cursor-pointer"
                >
                  Log out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
