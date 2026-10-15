import React from 'react';

interface MetricCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  iconColor?: string;
}

export const MetricCard: React.FC<MetricCardProps> = ({ title, value, icon, iconColor }) => {
  return (
    <div className="metric-card">
      <div className="metric-icon" style={iconColor ? { color: iconColor } : undefined}>
        {icon}
      </div>
      <div>
        <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{title}</div>
        <div className="metric-value">{value}</div>
      </div>
    </div>
  );
};
