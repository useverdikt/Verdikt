/** Enter/Space activation for role="button" rows that are not native <button>s. */
export function handleActivatableKeyDown(event, onActivate) {
  if (!onActivate) return;
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    onActivate();
  }
}
