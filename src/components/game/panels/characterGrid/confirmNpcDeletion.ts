export async function confirmNpcDeletion(
  confirm: () => Promise<boolean>,
  onDelete: () => void | Promise<void>,
): Promise<boolean> {
  if (!await confirm()) return false;
  await onDelete();
  return true;
}
