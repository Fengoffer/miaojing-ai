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
// Tab 3: Pricing & Credits
// ============================================================

export default function PricingTab() {
  const { config, updateMembershipPlan, addCreditPricing, updateCreditPricing, removeCreditPricing } = useAdminConfig();
  const [editingPricing, setEditingPricing] = useState<string | null>(null);
  const [editingFeatures, setEditingFeatures] = useState<string | null>(null);
  const [featureDrafts, setFeatureDrafts] = useState<Record<string, string[]>>({});

  const getFeatureDraft = (tier: string, features: string[]): string[] => {
    if (editingFeatures === tier && featureDrafts[tier]) return featureDrafts[tier];
    return features;
  };

  const startEditFeatures = (tier: string, features: string[]) => {
    setEditingFeatures(tier);
    setFeatureDrafts(prev => ({ ...prev, [tier]: [...features] }));
  };

  const saveFeatures = (tier: string) => {
    const drafts = featureDrafts[tier];
    if (drafts) {
      updateMembershipPlan(tier, { features: drafts.filter(f => f.trim()) });
    }
    setEditingFeatures(null);
  };

  const updateFeatureDraft = (tier: string, index: number, value: string) => {
    setFeatureDrafts(prev => ({
      ...prev,
      [tier]: prev[tier].map((f, i) => i === index ? value : f),
    }));
  };

  const addFeatureDraft = (tier: string) => {
    setFeatureDrafts(prev => ({
      ...prev,
      [tier]: [...(prev[tier] || []), ''],
    }));
  };

  const removeFeatureDraft = (tier: string, index: number) => {
    setFeatureDrafts(prev => ({
      ...prev,
      [tier]: prev[tier].filter((_, i) => i !== index),
    }));
  };

  return (
    <div className="space-y-6">
      {/* Membership Plans */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">会员等级定价</CardTitle>
          <CardDescription>设置各等级会员的月费、积分、配额和权益</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {config.membershipPlans.map(plan => (
              <Card key={plan.tier} className={plan.tier === 'pro' ? 'border-primary' : ''}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{plan.name}</CardTitle>
                    {plan.tier === 'pro' && <Badge>推荐</Badge>}
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="text-3xl font-bold">
                    ¥{plan.price}<span className="text-sm font-normal text-muted-foreground">/月</span>
                  </div>
                  <Separator />
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2">
                      <Coins className="h-4 w-4 text-primary" />
                      <span>每月 {plan.credits} 积分</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-primary" />
                      <span>每日 {plan.dailyQuota} 次</span>
                    </div>
                  </div>
                  {/* Features */}
                  <Separator />
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label className="text-xs font-medium">权益列表</Label>
                      {editingFeatures === plan.tier ? (
                        <div className="flex gap-1">
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => saveFeatures(plan.tier)}>
                            <Check className="h-3 w-3 mr-1" />保存
                          </Button>
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => setEditingFeatures(null)}>
                            取消
                          </Button>
                        </div>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={() => startEditFeatures(plan.tier, plan.features)}>
                          <Pencil className="h-3 w-3 mr-1" />编辑
                        </Button>
                      )}
                    </div>
                    {editingFeatures === plan.tier ? (
                      <div className="space-y-1.5">
                        {getFeatureDraft(plan.tier, plan.features).map((f, i) => (
                          <div key={i} className="flex items-center gap-1">
                            <Input
                              className="h-7 text-xs"
                              value={f}
                              onChange={e => updateFeatureDraft(plan.tier, i, e.target.value)}
                              placeholder="输入权益描述..."
                            />
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => removeFeatureDraft(plan.tier, i)}>
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ))}
                        <Button size="sm" variant="outline" className="h-7 w-full text-xs gap-1" onClick={() => addFeatureDraft(plan.tier)}>
                          <Plus className="h-3 w-3" />添加权益
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {plan.features.map((f, i) => (
                          <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Check className="h-3 w-3 text-primary shrink-0" />
                            <span>{f}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1">
                        <Label className="text-xs">月费 (元)</Label>
                        <Input
                          type="number" size={1}
                          value={plan.price}
                          onChange={e => updateMembershipPlan(plan.tier, { price: Number(e.target.value) })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">月积分</Label>
                        <Input
                          type="number"
                          value={plan.credits}
                          onChange={e => updateMembershipPlan(plan.tier, { credits: Number(e.target.value) })}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">每日配额</Label>
                      <Input
                        type="number"
                        value={plan.dailyQuota}
                        onChange={e => updateMembershipPlan(plan.tier, { dailyQuota: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Credit Packages */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg">积分充值包</CardTitle>
              <CardDescription>设置可购买的积分包价格</CardDescription>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => {
              addCreditPricing({ name: '新积分包', credits: 100, price: 9.9, bonusCredits: 0, isPopular: false });
              toast.success('已添加');
            }}>
              <Plus className="h-4 w-4" />添加
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {config.creditPricings.map(cp => (
              <div key={cp.id} className="flex items-center gap-4 p-4 rounded-lg border border-border">
                {editingPricing === cp.id ? (
                  <>
                    <div className="flex-1 grid grid-cols-4 gap-3">
                      <Input value={cp.name} onChange={e => updateCreditPricing(cp.id, { name: e.target.value })} placeholder="名称" />
                      <Input type="number" value={cp.credits} onChange={e => updateCreditPricing(cp.id, { credits: Number(e.target.value) })} placeholder="积分" />
                      <Input type="number" value={cp.price} onChange={e => updateCreditPricing(cp.id, { price: Number(e.target.value) })} placeholder="价格" />
                      <Input type="number" value={cp.bonusCredits} onChange={e => updateCreditPricing(cp.id, { bonusCredits: Number(e.target.value) })} placeholder="赠送" />
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setEditingPricing(null)}>
                      <Check className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Gift className="h-5 w-5 text-primary" />
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{cp.name}</span>
                        {cp.isPopular && <Badge className="text-xs">热门</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {cp.credits} 积分 · ¥{cp.price}
                        {cp.bonusCredits > 0 && ` · 赠送 ${cp.bonusCredits}`}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => setEditingPricing(cp.id)}>
                      <Edit3 className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { removeCreditPricing(cp.id); toast.success('已删除'); }}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
