// "All / Phone / Email …" buttons for the when-tickets-arrive heatmap (agent
// page and portal). Returns the chosen grid with a line comparing channel peaks.
import React, { useState } from 'react';
import { Tabs } from '@retailinmotion/ui/react';
import { gridSummary } from '../../../src/channels.js';

export function useChannel(timeOfDay) {
  const [selected, setSelected] = useState('all');
  const channels = Array.isArray(timeOfDay?.byChannel) ? timeOfDay.byChannel.filter((c) => c.tickets > 0) : [];
  const chosen = channels.find((c) => c.value === selected) || null;
  return { channels, chosen, selected: chosen ? selected : 'all', setSelected, grid: chosen ? chosen.grid : timeOfDay?.grid };
}

/** The buttons and a one-line comparison of each channel's peak, e.g. "Phone 62% · peaks Mon 08:00–11:00". */
export default function ChannelPicker({ timeOfDay, channel, noun = 'tickets' }) {
  if (channel.channels.length < 2) return null;
  return <div className="ci-channels">
    <Tabs items={[{ id: 'all', label: 'All' }, ...channel.channels.map((c) => ({ id: c.value, label: `${c.value} ${c.share}%` }))]} active={channel.selected} onChange={channel.setSelected} />
    <p className="nq-muted">{timeOfDay.channelField ? `By ${timeOfDay.channelField}: ` : ''}{channel.channels.map((c) => {
      const s = gridSummary(c.grid);
      return s ? `${c.value} peaks ${s.busiestDay} ${s.busiestHours.replace(/ \(.*\)$/, '')}` : null;
    }).filter(Boolean).join(' · ')}. Shares are of the {noun} analysed.</p>
  </div>;
}
