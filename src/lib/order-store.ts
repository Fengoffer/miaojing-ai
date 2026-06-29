/**
 * Order Store - 用户订单记录
 *
 * 记录用户的真实订单（会员订阅、积分购买等），
 * 在个人中心订单Tab和管理后台订单管理中展示。
 */

export interface OrderRecord {
  id: string;
  orderNo: string;
  productName: string;
  amount: number;       // 金额（元）
  status: 'pending' | 'paid' | 'cancelled' | 'refunded';
  type: 'membership' | 'credits' | 'other';
  createdAt: string;    // ISO string
  userId?: string;
  userName?: string;
}

const STORAGE_KEY = 'miaojing_orders';
const ADMIN_STORAGE_KEY = 'miaojing_admin_orders';
const MAX_RECORDS = 500;

function loadRecords(key: string): OrderRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    return JSON.parse(raw) as OrderRecord[];
  } catch {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
    return [];
  }
}

function saveRecords(key: string, records: OrderRecord[]): void {
  if (typeof window === 'undefined') return;
  const trimmed = records.slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(key, JSON.stringify(trimmed));
  } catch {
    let shrinking = [...trimmed];
    while (shrinking.length > 0) {
      try {
        localStorage.setItem(key, JSON.stringify(shrinking));
        break;
      } catch {
        shrinking = shrinking.slice(0, -1);
      }
    }
  }
  window.dispatchEvent(new CustomEvent('orders-updated'));
}

function generateOrderNo(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `MJ${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${String(Math.floor(Math.random() * 1000)).padStart(3, '0')}`;
}

/** Add order for current user */
export function addOrder(record: Omit<OrderRecord, 'id' | 'orderNo' | 'createdAt'>): OrderRecord {
  const records = loadRecords(STORAGE_KEY);
  const newRecord: OrderRecord = {
    ...record,
    orderNo: generateOrderNo(),
    id: `ord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  records.unshift(newRecord);
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  saveRecords(STORAGE_KEY, records);

  // Also save to admin orders if we have user info
  if (record.userId) {
    const adminRecords = loadRecords(ADMIN_STORAGE_KEY);
    adminRecords.unshift(newRecord);
    if (adminRecords.length > MAX_RECORDS) adminRecords.length = MAX_RECORDS;
    saveRecords(ADMIN_STORAGE_KEY, adminRecords);
  }

  return newRecord;
}

/** Get user's orders */
export function getUserOrders(): OrderRecord[] {
  return loadRecords(STORAGE_KEY);
}

/** Get all orders (admin) */
export function getAllOrders(): OrderRecord[] {
  return loadRecords(ADMIN_STORAGE_KEY);
}

/** Update order status */
export function updateOrderStatus(orderId: string, status: OrderRecord['status']): void {
  // Update in admin store
  const adminRecords = loadRecords(ADMIN_STORAGE_KEY);
  const adminIdx = adminRecords.findIndex(r => r.id === orderId);
  if (adminIdx >= 0) {
    adminRecords[adminIdx].status = status;
    saveRecords(ADMIN_STORAGE_KEY, adminRecords);
  }
  // Update in user store
  const userRecords = loadRecords(STORAGE_KEY);
  const userIdx = userRecords.findIndex(r => r.id === orderId);
  if (userIdx >= 0) {
    userRecords[userIdx].status = status;
    saveRecords(STORAGE_KEY, userRecords);
  }
}

/** Format order time to minutes */
export function formatOrderTime(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

import { useState, useEffect, useCallback } from 'react';

export function useUserOrders() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);

  useEffect(() => {
    setOrders(loadRecords(STORAGE_KEY));
    const handler = () => setOrders(loadRecords(STORAGE_KEY));
    window.addEventListener('orders-updated', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('orders-updated', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const add = useCallback((record: Omit<OrderRecord, 'id' | 'orderNo' | 'createdAt'>) => {
    const newRecord = addOrder(record);
    setOrders(loadRecords(STORAGE_KEY));
    return newRecord;
  }, []);

  return { orders, add };
}

export function useAdminOrders() {
  const [orders, setOrders] = useState<OrderRecord[]>([]);

  useEffect(() => {
    setOrders(loadRecords(ADMIN_STORAGE_KEY));
    const handler = () => setOrders(loadRecords(ADMIN_STORAGE_KEY));
    window.addEventListener('orders-updated', handler);
    window.addEventListener('storage', handler);
    return () => {
      window.removeEventListener('orders-updated', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const updateStatus = useCallback((orderId: string, status: OrderRecord['status']) => {
    updateOrderStatus(orderId, status);
    setOrders(loadRecords(ADMIN_STORAGE_KEY));
  }, []);

  return { orders, updateStatus };
}
