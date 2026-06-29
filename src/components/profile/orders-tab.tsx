'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Receipt } from 'lucide-react';
import { formatOrderTime, useUserOrders } from '@/lib/order-store';

export default function OrdersTab() {
  const { orders } = useUserOrders();

  return (
<Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" />订单管理</CardTitle>
              </CardHeader>
              <CardContent>
                {orders.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <Receipt className="h-12 w-12 mx-auto mb-3 opacity-20" />
                    <p>暂无订单</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {orders.map((order) => (
                      <div key={order.id} className="flex items-center justify-between p-4 rounded-lg border border-border/50">
                        <div>
                          <p className="font-medium">{order.productName}</p>
                          <p className="text-xs text-muted-foreground mt-1">{order.orderNo} | {formatOrderTime(order.createdAt)}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">¥{order.amount.toFixed(2)}</p>
                          <Badge variant={order.status === 'paid' ? 'default' : order.status === 'cancelled' ? 'destructive' : 'outline'} className="mt-1">
                            {order.status === 'paid' ? '已支付' : order.status === 'cancelled' ? '已取消' : order.status === 'refunded' ? '已退款' : '待支付'}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
  );
}
