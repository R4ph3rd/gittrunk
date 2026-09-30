let confirmDestructive = true;

/** Whether history-changing operations ask for confirmation. The settings feature will wire this. */
export function getConfirmDestructive(): boolean {
  return confirmDestructive;
}

export function setConfirmDestructive(value: boolean): void {
  confirmDestructive = value;
}
