import { describe, expect, it, vi } from 'vitest';
import { createUpdateController } from './update-controller';

const setup = () => {
  const reload = vi.fn();
  const offer = vi.fn();
  const activate = vi.fn();
  return { reload, offer, activate, controller: createUpdateController({ reload, offer }) };
};

describe('mise à jour du client', () => {
  it('l’onglet qui demande la mise à jour active la version en attente, puis recharge', () => {
    const { reload, offer, activate, controller } = setup();
    controller.update(activate);
    expect(activate).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
    controller.onNeedReload();
    expect(reload).toHaveBeenCalledOnce();
    expect(offer).not.toHaveBeenCalled();
  });

  it('un autre onglet a accepté : pas de rechargement imposé, le bandeau est reproposé', () => {
    const { reload, offer, activate, controller } = setup();
    controller.onNeedReload();
    expect(reload).not.toHaveBeenCalled();
    expect(offer).toHaveBeenCalledOnce();
    // Plus rien n'attend : « Mettre à jour » recharge simplement la page.
    controller.update(activate);
    expect(activate).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalledOnce();
  });
});
