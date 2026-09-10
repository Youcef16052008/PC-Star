import { PRODUCTS } from './data.js'

const FACE_IDS = ['cpu-7800x3d', 'gpu-4070s', 'mb-b650', 'ram-32', 'ssd-1t', 'psu-750', 'cooler', 'headset']
const CORE_ID = 'case-atx'

export default function Orbit({ onOpen, onPick, faint }) {
  const faces = FACE_IDS.map((id) => PRODUCTS.find((p) => p.id === id)).filter(Boolean)
  const core = PRODUCTS.find((p) => p.id === CORE_ID)
  const coreSrc = core && core.photos && core.photos[0]

  return (
    <div className={`orbit-scene ${faint ? 'faint' : ''}`} aria-hidden={faint}>
      <div className="orbit-core">
        {coreSrc ? <img src={coreSrc} alt="" /> : null}
        <span>Case</span>
      </div>
      <div className="orbit-ring">
        {faces.map((p, i) => (
          <div className="orbit-slot" style={{ '--i': i, '--n': faces.length }} key={p.id}>
            <button
              type="button"
              className="orbit-face"
              onClick={faint ? undefined : () => {
                if (onOpen) onOpen(p.id)
                else if (onPick) onPick(p.category)
              }}
              tabIndex={faint ? -1 : 0}
              aria-label={faint ? undefined : p.name}
            >
              <img src={p.photos[0]} alt="" />
              <span>{p.category === 'accessories' ? 'Gear' : p.category === 'motherboard' ? 'Board' : p.category.toUpperCase()}</span>
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
