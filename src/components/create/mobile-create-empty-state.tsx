import { Sparkles } from 'lucide-react';

type MobileCreateEmptyStateProps = {
  title: string;
  description: string;
  chips?: string[];
};

export function MobileCreateEmptyState({ title, description, chips = [] }: MobileCreateEmptyStateProps) {
  return (
    <div className="create-mobile-empty-state">
      <div className="create-mobile-empty-state-icon">
        <Sparkles className="h-5 w-5" />
      </div>
      <div className="space-y-1.5">
        <p className="create-mobile-empty-state-title">{title}</p>
        <p className="create-mobile-empty-state-description">{description}</p>
      </div>
      {chips.length > 0 && (
        <div className="create-mobile-empty-state-chips">
          {chips.map(chip => (
            <span key={chip}>{chip}</span>
          ))}
        </div>
      )}
    </div>
  );
}
