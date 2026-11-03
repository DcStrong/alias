export const escapeHtml=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

export function guesserButtons(players,activeId,selectedId) {
  const choices=players.filter(player=>!player.left&&player.id!==activeId);
  return `<div role="group" aria-label="Кто первым угадал?" class="guesser-buttons">${choices.map(player=>`<button type="button" class="secondary guesser-choice" data-winner="${escapeHtml(player.id)}" aria-pressed="${player.id===selectedId}">${escapeHtml(player.name)}</button>`).join('')}</div>`;
}
