// pi2pi Default Avatars — PNG images from assets/avatars/
// Import all avatar PNGs via Vite glob
const modules = import.meta.glob('../assets/avatars/avatar-*.png', { eager: true, query: '?url', import: 'default' });

const keys = Object.keys(modules).sort();
export const DEFAULT_AVATARS = keys.map((key, i) => ({
  id: `avatar-${String(i + 1).padStart(2, "0")}`,
  index: i,
  url: modules[key],
}));
