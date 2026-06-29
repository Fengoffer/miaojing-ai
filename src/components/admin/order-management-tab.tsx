'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useAdminConfig, type CreditPricing } from '@/lib/admin-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useSiteConfig } from '@/lib/site-config';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { AlertCircle, AlertTriangle, Calendar, Check, CheckCircle2, Coins, CreditCard, Crown, Database, Download, Edit3, FileUp, Gift, Globe, Loader2, Megaphone, Pencil, Plus, Receipt, Save, ToggleLeft, Trash2, Upload, X, Zap } from 'lucide-react';
import { toast } from 'sonner';
// ============================================================
// Tab 4: Order Management
// ============================================================

export default function OrderManagementTab() {
  const [orders, setOrders] = useState<Array<{
    id: string; order_no: string; product_name: string; amount: number;
    status: string; type: string; user_id: string; user_email: string;
    created_at: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/admin/orders');
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders || []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchOrders();
  }, [fetchOrders]);

  const updateStatus = async (orderId: string, newStatus: string) => {
    try {
      const res = await fetch('/api/admin/orders', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, updates: { status: newStatus } }),
      });
      if (res.ok) {
        toast.success('状态已更新');
        fetchOrders();
      } else {
        toast.error('更新失败');
      }
    } catch {
      toast.error('网络错误');
    }
  };

  const filteredOrders = statusFilter === 'all' ? orders : orders.filter(o => o.status === statusFilter);

  const statusLabel = (s: string) => {
    const map: Record<string, string> = { pending: '待支付', paid: '已支付', cancelled: '已取消', refunded: '已退款' };
    return map[s] || s;
  };
  const statusVariant = (s: string): 'default' | 'outline' | 'destructive' | 'secondary' => {
    const map: Record<string, 'default' | 'outline' | 'destructive' | 'secondary'> = { paid: 'default', pending: 'outline', cancelled: 'destructive', refunded: 'secondary' };
    return map[s] || 'outline';
  };

  const formatTime = (iso: string) => {
    if (!iso) return '-';
    const d = new Date(iso);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2"><Receipt className="h-5 w-5" />订单管理</CardTitle>
            <CardDescription>查看和管理所有订单</CardDescription>
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部</SelectItem>
              <SelectItem value="pending">待支付</SelectItem>
              <SelectItem value="paid">已支付</SelectItem>
              <SelectItem value="cancelled">已取消</SelectItem>
              <SelectItem value="refunded">已退款</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="text-center py-12 text-muted-foreground">
            <Loader2 className="h-8 w-8 mx-auto mb-3 animate-spin" />
            <p>加载中...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground">
            <Receipt className="h-12 w-12 mx-auto mb-3 opacity-20" />
            <p>暂无订单</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map(order => (
              <div key={order.id} className="flex items-center justify-between p-4 rounded-lg border border-border/50">
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{order.product_name || '订单'}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {order.order_no || order.id?.slice(0, 8)} | {formatTime(order.created_at)}
                    {order.user_email && <span> | {order.user_email}</span>}
                  </p>
                </div>
                <div className="text-right shrink-0 ml-4">
                  <p className="font-semibold">¥{(order.amount || 0).toFixed(2)}</p>
                  <div className="flex items-center gap-2 mt-1 justify-end">
                    <Badge variant={statusVariant(order.status)}>{statusLabel(order.status)}</Badge>
                    {order.status === 'pending' && (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => updateStatus(order.id, 'paid')}>确认支付</Button>
                    )}
                    {order.status === 'paid' && (
                      <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => updateStatus(order.id, 'refunded')}>退款</Button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
