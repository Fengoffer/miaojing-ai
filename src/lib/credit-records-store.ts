/**
 * Credit Transaction Store - 前端积分记录
 *
 * 记录用户积分的真实变动（充值/消耗/赠送等），
 * 在个人中心积分Tab中展示，时间精确到分钟。
 *
 * 数据来源：
 * - 生成消耗：创作组件成功后调用 addCreditRecord
 * - 注册赠送：注册成功后调用 addCreditRecord
 * - 充值增加：管理员充值后调用 addCreditRecord
 */

export interface CreditRecord {
  id: string;
  type: 'gift' | 'consume' | 'topup' | 'refund' | 'admin';
  amount: number;          // 正数=增加，负数=减少
  balanceAfter: number;    // 变动后余额
  description: string;
  createdAt: string;       // ISO string，显示时精确到分钟
}

const STORAGE_KEY = 'miaojing_credit_records';
const MAX_RECORDS = 500;

function loadRecords(): CreditRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CreditRecord[];
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return [];
  }
}

function saveRecords(records: CreditRecord[]): void {
  if (typeof window === 'undefined') return;
  const trimmed = records.slice(0, MAX_RECORDS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    let shrinking = [...trimmed];
    while (shrinking.length > 0) {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(shrinking));
        break;
      } catch {
        shrinking = shrinking.slice(0, -1);
      }
    }
  }
  window.dispatchEvent(new CustomEvent('credit-records-updated'));
}

export function addCreditRecord(record: Omit<CreditRecord, 'id' | 'createdAt'>): CreditRecord {
  const records = loadRecords();
  const newRecord: CreditRecord = {
    ...record,
    id: `cr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
  };
  records.unshift(newRecord);
  if (records.length > MAX_RECORDS) records.length = MAX_RECORDS;
  saveRecords(records);
  return newRecord;
}

export function getCreditRecords(): CreditRecord[] {
  return loadRecords();
}

export function clearCreditRecords(): void {
  saveRecords([]);
}

/** 格式化时间为精确到分钟的字符串 */
export function formatRecordTime(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

import { useState, useEffect, useCallback } from 'react';

export function useCreditRecords() {
  const [records, setRecords] = useState<CreditRecord[]>([]);

  useEffect(() => {
    setRecords(loadRecords());

    const handler = () => setRecords(loadRecords());
    window.addEventListener('credit-records-updated', handler);
    window.addEventListener('storage', handler);

    return () => {
      window.removeEventListener('credit-records-updated', handler);
      window.removeEventListener('storage', handler);
    };
  }, []);

  const add = useCallback((record: Omit<CreditRecord, 'id' | 'createdAt'>) => {
    const newRecord = addCreditRecord(record);
    setRecords(loadRecords());
    return newRecord;
  }, []);

  const clear = useCallback(() => {
    clearCreditRecords();
    setRecords([]);
  }, []);

  return { records, add, clear };
}
