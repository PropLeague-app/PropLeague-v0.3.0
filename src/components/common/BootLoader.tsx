import logo from '../../assets/logo-color.png';

/** The brief screen shown while auth and leagues load. The logo starts grayed out and fills in
 * left to right. The fill is timed rather than tied to real progress (loading has no measurable
 * percentage), so it eases toward full and simply holds if loading takes longer. Both loading
 * states in RootRedirect render this same component in the same spot, so React keeps one
 * instance and the animation does not restart between them. */
export function BootLoader() {
  return (
    <div className="min-h-screen bg-bg flex items-center justify-center" role="status" aria-label="Loading">
      <div className="relative w-12 h-12">
        <img src={logo} alt="" className="absolute inset-0 w-full h-full object-contain opacity-20 grayscale" draggable={false} />
        <img src={logo} alt="" className="absolute inset-0 w-full h-full object-contain boot-fill" draggable={false} />
      </div>
    </div>
  );
}
