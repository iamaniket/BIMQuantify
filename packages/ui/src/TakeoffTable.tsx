'use client';

import React from 'react';
import type { TakeoffItem } from '@bim-quantify/ai-takeoff';

export interface TakeoffTableProps {
  items: TakeoffItem[];
  currency?: string;
}

/**
 * Renders a quantity takeoff as a sortable HTML table.
 */
export function TakeoffTable({
  items,
  currency = 'USD',
}: TakeoffTableProps): React.ReactElement {
  const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    maximumFractionDigits: 2,
  });

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ background: '#f3f4f6' }}>
            {['Type', 'Name', 'Material', 'Qty', 'Unit', 'Unit Cost', 'Total Cost', 'Confidence'].map(
              (h) => (
                <th
                  key={h}
                  style={{
                    padding: '8px 12px',
                    textAlign: 'left',
                    borderBottom: '2px solid #e5e7eb',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {h}
                </th>
              ),
            )}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.elementId} style={{ borderBottom: '1px solid #e5e7eb' }}>
              <td style={{ padding: '6px 12px' }}>{item.elementType}</td>
              <td style={{ padding: '6px 12px' }}>{item.elementName ?? '—'}</td>
              <td style={{ padding: '6px 12px' }}>{item.material}</td>
              <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                {item.quantity.toFixed(2)}
              </td>
              <td style={{ padding: '6px 12px' }}>{item.unit}</td>
              <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                {item.unitCost != null ? formatter.format(item.unitCost) : '—'}
              </td>
              <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                {item.totalCost != null ? formatter.format(item.totalCost) : '—'}
              </td>
              <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                {(item.confidence * 100).toFixed(0)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
