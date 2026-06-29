import { SelectGroup, SelectItem, SelectLabel, SelectSeparator } from '@/components/ui/select';

type ModelOptionGroup = '默认模型' | '自定义模型';

export type GroupedModelOption = {
  id: string;
  label: string;
  group: string;
};

const MODEL_GROUP_ORDER: ModelOptionGroup[] = ['默认模型', '自定义模型'];

export function GroupedModelSelectItems({ options }: { options: GroupedModelOption[] }) {
  return (
    <>
      {MODEL_GROUP_ORDER.map((group, groupIndex) => {
        const groupOptions = options.filter(option => option.group === group);
        if (groupOptions.length === 0) return null;
        return (
          <SelectGroup key={group}>
            {groupIndex > 0 && <SelectSeparator />}
            <SelectLabel>{group}</SelectLabel>
            {groupOptions.map(option => (
              <SelectItem key={option.id} value={option.id}>{option.label}</SelectItem>
            ))}
          </SelectGroup>
        );
      })}
    </>
  );
}
