export function CaptureTimeInput({ value, onChange, min, max }: { value: string; onChange: (value: string) => void; min: string; max: string }) {
  return <label className="capture-time-field">
    <span className="capture-time-display" aria-hidden="true">{value ? `${value.slice(5, 10).replace("-", "/")} ${value.slice(11, 16)}` : "拍攝時間"}<span>⌄</span></span>
    <input aria-label="拍攝時間" type="datetime-local" required min={min} max={max} value={value}
      onClick={event => { try { event.currentTarget.showPicker?.(); } catch { /* Keep the native input available when the picker is unavailable. */ } }}
      onChange={event => onChange(event.target.value)}/>
  </label>;
}
