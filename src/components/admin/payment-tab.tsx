'use client';

import { useState } from 'react';
import { useAdminConfig } from '@/lib/admin-store';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { CreditCard, Save, Settings } from 'lucide-react';
import { toast } from 'sonner';
// Tab 5: Payment Settings
// ============================================================

const SECRET_CONFIG_KEY_PATTERN = /(key|secret|private)/i;

function stripSecretConfig(config: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(config || {}).map(([key, value]) => [
      key,
      SECRET_CONFIG_KEY_PATTERN.test(key) ? '' : value,
    ]),
  );
}

export default function PaymentTab() {
  const { config, togglePaymentMethod, updatePaymentMethod } = useAdminConfig();
  const [editingId, setEditingId] = useState<string | null>(null);
  // Local editing state for the currently active payment method config
  const [editConfig, setEditConfig] = useState<Record<string, string>>({});

  const paymentIcons: Record<string, string> = {
    alipay: '支付宝',
    wechat: '微信支付',
    stripe: 'Stripe',
    manual: '手动转账',
  };

  const startEdit = (pm: typeof config.paymentMethods[0]) => {
    setEditingId(pm.id);
    setEditConfig(stripSecretConfig(pm.config));
  };

  const saveEdit = async () => {
    if (!editingId) return;
    try {
      await updatePaymentMethod(editingId, { config: { ...editConfig } });
      toast.success('配置已保存');
      setEditingId(null);
      setEditConfig({});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '保存失败');
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditConfig({});
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">支付方式</CardTitle>
          <CardDescription>启用和配置可用的支付渠道</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {config.paymentMethods.map(pm => (
            <div key={pm.id} className="flex items-center gap-4 p-4 rounded-lg border border-border">
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${pm.isActive ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
                <CreditCard className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{pm.name}</span>
                  <Badge variant={pm.isActive ? 'default' : 'secondary'}>
                    {pm.isActive ? '已启用' : '未启用'}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{paymentIcons[pm.type] || pm.type}</p>
              </div>
              <Switch
                checked={pm.isActive}
                onCheckedChange={() => {
                  togglePaymentMethod(pm.id).catch(err => {
                    toast.error(err instanceof Error ? err.message : '操作失败');
                  });
                }}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Payment Config Details (when enabled) */}
      {config.paymentMethods.filter(pm => pm.isActive).map(pm => {
        const isEditing = editingId === pm.id;
        const currentConfig = isEditing ? editConfig : pm.config;

        return (
          <Card key={`config-${pm.id}`}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">{pm.name} 配置</CardTitle>
                  <CardDescription>填写支付渠道的商户信息</CardDescription>
                </div>
                {!isEditing && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => startEdit(pm)}>
                    <Settings className="h-3.5 w-3.5" />
                    配置
                  </Button>
                )}
              </div>
            </CardHeader>
            {isEditing ? (
              <CardContent className="space-y-4">
                {pm.type === 'alipay' && (
                  <>
                    <div className="space-y-2">
                      <Label>应用ID (App ID)</Label>
                      <Input
                        placeholder="2021xxx"
                        value={currentConfig.appId || ''}
                        onChange={e => setEditConfig(prev => ({ ...prev, appId: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>商户私钥</Label>
                      <Input
                        type="password"
                        placeholder={pm.config.privateKey ? `已保存：${pm.config.privateKey}` : 'MIIEvQ...'}
                        value={currentConfig.privateKey || ''}
                        onChange={e => setEditConfig(prev => ({ ...prev, privateKey: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>支付宝公钥</Label>
                      <Input
                        type="password"
                        placeholder={pm.config.alipayPublicKey ? `已保存：${pm.config.alipayPublicKey}` : 'MIIBIjAN...'}
                        value={currentConfig.alipayPublicKey || ''}
                        onChange={e => setEditConfig(prev => ({ ...prev, alipayPublicKey: e.target.value }))}
                      />
                    </div>
                  </>
                )}
                {pm.type === 'wechat' && (
                  <>
                    <div className="space-y-2">
                      <Label>商户号 (Mch ID)</Label>
                      <Input
                        placeholder="16xxxx"
                        value={currentConfig.mchId || ''}
                        onChange={e => setEditConfig(prev => ({ ...prev, mchId: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>API 密钥</Label>
                      <Input
                        type="password"
                        placeholder={pm.config.apiKey ? `已保存：${pm.config.apiKey}` : '32位密钥'}
                        value={currentConfig.apiKey || ''}
                        onChange={e => setEditConfig(prev => ({ ...prev, apiKey: e.target.value }))}
                      />
                    </div>
                  </>
                )}
                {pm.type === 'manual' && (
                  <div className="space-y-2">
                    <Label>转账说明</Label>
                    <Textarea
                      placeholder="请将款项转入以下账户：&#10;开户行：xxx银行&#10;账号：6222xxxx&#10;户名：xxx公司"
                      value={currentConfig.instructions || ''}
                      onChange={e => setEditConfig(prev => ({ ...prev, instructions: e.target.value }))}
                    />
                  </div>
                )}
                {pm.type === 'stripe' && (
                  <>
                    <div className="space-y-2">
                      <Label>Publishable Key</Label>
                      <Input
                        placeholder="pk_live_..."
                        value={currentConfig.publishableKey || ''}
                        onChange={e => setEditConfig(prev => ({ ...prev, publishableKey: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Secret Key</Label>
                      <Input
                        type="password"
                        placeholder={pm.config.secretKey ? `已保存：${pm.config.secretKey}` : 'sk_live_...'}
                        value={currentConfig.secretKey || ''}
                        onChange={e => setEditConfig(prev => ({ ...prev, secretKey: e.target.value }))}
                      />
                    </div>
                  </>
                )}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" className="gap-1.5" onClick={saveEdit}>
                    <Save className="h-3.5 w-3.5" />
                    保存
                  </Button>
                  <Button size="sm" variant="outline" onClick={cancelEdit}>
                    取消
                  </Button>
                </div>
              </CardContent>
            ) : (
              <CardContent>
                {Object.keys(pm.config).length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4 text-center">尚未配置，点击右上角「配置」按钮开始</p>
                ) : (
                  <div className="space-y-2">
                    {Object.entries(pm.config).map(([key, value]) => (
                      <div key={key} className="flex items-center gap-2 text-sm">
                        <span className="text-muted-foreground min-w-[120px]">{key}</span>
                        <span className="font-mono text-xs">
                          {key.toLowerCase().includes('key') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('private')
                            ? '••••••••'
                            : String(value)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        );
      })}

    </div>
  );
}
