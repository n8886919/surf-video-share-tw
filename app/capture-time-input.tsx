"use client";

import { useEffect, useId, useRef, useState } from "react";
import { FORECAST_HOUR_MAX, FORECAST_HOUR_MIN, PRODUCT_TIME_ZONE, isWithinUploadWindow } from "../packages/domain/src/time-policy";
import { UploadDialog } from "./upload-dialog";

const taipeiDate = new Intl.DateTimeFormat("en-CA", { timeZone: PRODUCT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function captureDateOptions(now: Date): string[] {
  if (!Number.isFinite(now.getTime())) return [];
  const parts = Object.fromEntries(taipeiDate.formatToParts(now).map(part => [part.type, part.value]));
  const today = Date.parse(`${parts.year}-${parts.month}-${parts.day}T00:00:00Z`);
  // Offer six complete past days plus today, avoiding the partial 168-hour day.
  // Before 05:00 today has no eligible capture time, so omit it too.
  return Array.from({ length: 7 }, (_, i) => new Date(today - (6 - i) * 86_400_000).toISOString().slice(0, 10))
    .filter(day => isWithinUploadWindow(`${day}T05:00+08:00`, now));
}

interface CaptureTimeProps {
  value: string;
  onChange: (value: string) => void;
  now: Date;
}

const hours = Array.from({ length: FORECAST_HOUR_MAX - FORECAST_HOUR_MIN + 1 }, (_, i) => String(i + FORECAST_HOUR_MIN).padStart(2, "0"));
const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
const dateLabel = new Intl.DateTimeFormat("zh-TW", { timeZone: "UTC", month: "numeric", day: "numeric", weekday: "short" });

function CaptureTimePicker({ value, onChange, now: parentNow, onClose }: CaptureTimeProps & { onClose: () => void }) {
  // Keep this draft stable while metadata finishes or the upload clock refreshes.
  // Closing without confirmation must leave the committed value untouched.
  const [date, setDate] = useState(value.slice(0, 10));
  const [hour, setHour] = useState(value.slice(11, 13));
  const [minute, setMinute] = useState(value.slice(14, 16));
  const [checkedNow, setCheckedNow] = useState(parentNow);
  const now = parentNow > checkedNow ? parentNow : checkedNow;
  const dates = captureDateOptions(now);
  const selectedDate = dates.includes(date) ? date : "";
  const availableHours = selectedDate ? hours.filter(item => isWithinUploadWindow(`${selectedDate}T${item}:00+08:00`, now)) : [];
  const selectedHour = availableHours.includes(hour) ? hour : "";
  const availableMinutes = selectedHour ? minutes.filter(item => isWithinUploadWindow(`${selectedDate}T${selectedHour}:${item}+08:00`, now)) : [];
  const selectedMinute = availableMinutes.includes(minute) ? minute : "";
  const selected = selectedDate && selectedHour && selectedMinute ? `${selectedDate}T${selectedHour}:${selectedMinute}` : "";
  function changeDate(next: string) {
    setDate(next);
    if (!isWithinUploadWindow(`${next}T${hour}:00+08:00`, now)) { setHour(""); setMinute(""); }
    else if (!isWithinUploadWindow(`${next}T${hour}:${minute}+08:00`, now)) setMinute("");
  }
  function changeHour(next: string) {
    setHour(next);
    if (!isWithinUploadWindow(`${selectedDate}T${next}:${minute}+08:00`, now)) setMinute("");
  }
  function confirm() {
    const currentNow = new Date();
    if (!selected || !captureDateOptions(currentNow).includes(selectedDate) || !isWithinUploadWindow(`${selected}+08:00`, currentNow)) {
      setCheckedNow(currentNow);
      setDate(""); setHour(""); setMinute("");
      return;
    }
    onChange(selected);
    onClose();
  }
  return <UploadDialog title="拍攝時間" onClose={onClose} showCloseButton={false}>
    <div className="capture-time-options">
      <label className="capture-date-option"><span>日期</span><select aria-label="拍攝日期" value={selectedDate} onChange={event => changeDate(event.target.value)}>
        <option value="">選擇日期</option>
        {dates.map(day => <option key={day} value={day}>{dateLabel.format(new Date(`${day}T00:00:00Z`))}</option>)}
      </select></label>
      <label><span>時（24 小時制）</span><select aria-label="拍攝小時（24 小時制）" value={selectedHour} disabled={!selectedDate} onChange={event => changeHour(event.target.value)}>
        <option value="">時</option>{availableHours.map(item => <option key={item} value={item}>{item}</option>)}
      </select></label>
      <label><span>分</span><select aria-label="拍攝分鐘" value={selectedMinute} disabled={!selectedHour} onChange={event => setMinute(event.target.value)}>
        <option value="">分</option>{availableMinutes.map(item => <option key={item} value={item}>{item}</option>)}
      </select></label>
    </div>
    <div className="upload-dialog-actions"><button type="button" className="small-primary" disabled={!selected} onClick={confirm}>確認</button></div>
  </UploadDialog>;
}

export function CaptureTimeInput(props: CaptureTimeProps) {
  const [open, setOpen] = useState(false);
  const valueId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (!open && wasOpen.current) trigger.current?.focus({ preventScroll: true });
    wasOpen.current = open;
  }, [open]);
  return <>
    <button ref={trigger} type="button" className="capture-time-field" aria-label="拍攝時間" aria-describedby={props.value ? valueId : undefined} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <span id={valueId} className="capture-time-display">{props.value ? `${props.value.slice(5, 10).replace("-", "/")} ${props.value.slice(11, 16)}` : "拍攝時間"}<span aria-hidden="true">⌄</span></span>
    </button>
    {open && <CaptureTimePicker {...props} onClose={() => setOpen(false)}/>}
  </>;
}
