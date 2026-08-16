/**
 * Feature flags. Off means the UI is hidden but the code stays; flip one on
 * for a session with e.g. localStorage.setItem('selfdoc-flag-heat', '1').
 */
const enabled = (name) => {
  try {
    return localStorage.getItem(`selfdoc-flag-${name}`) === '1';
  } catch {
    return false;
  }
};

export const flags = {
  // Parked pending a rethink of what heat should measure.
  heat: enabled('heat'),
};
