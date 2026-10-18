// Mobile companion preview: AR put-away scan and the task list, shown in phone frames.
import type { CSSProperties } from 'react';

const abs = (s: CSSProperties): CSSProperties => ({ position: 'absolute', ...s });
const frame = (top: string, left: string, border: string) => abs({ top, left, width: '7.5rem', height: '5.4rem', border });
const tag = (top: string, left: string, extra: CSSProperties = {}): CSSProperties =>
  abs({ top, left, padding: '.25rem .5rem', background: '#fff', fontSize: '.6875rem', ...extra });
const card: CSSProperties = { background: '#fff', border: '1px solid #DEE0E4', padding: '.875rem' };
const cardHead: CSSProperties = { display: 'flex', justifyContent: 'space-between', fontSize: '.75rem', color: '#767A82' };
const cardTitle: CSSProperties = { fontSize: '.9375rem', fontWeight: 600 };
const cardSub: CSSProperties = { fontSize: '.75rem', color: '#4A4D55' };

export function Mobile({ hidden }: { hidden: boolean }) {
  return (
    <section className={`page${hidden ? ' hidden' : ''}`}>
      <div className="mob">
        <div className="intro">
          <span className="eb" style={{ color: '#A1B9FB' }}>Mobile companion</span>
          <h2>Scan first. The twin for planning, the scanner for doing.</h2>
          <p>Barcode, QR and RFID scanning with an AR mode that shows bin contents over the camera view. Works offline and syncs when back on the network.</p>
        </div>

        <div className="phone"><div className="scr" style={{ background: 'linear-gradient(#3B3E45,#24262B)' }}>
          <div style={abs({ top: 0, left: 0, right: 0, height: '2.75rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.375rem', color: '#fff', fontSize: '.75rem', fontWeight: 600, whiteSpace: 'nowrap' })}>
            <span>09:41</span><span>AR · Rack D</span>
          </div>
          <div style={abs({ top: '3.5rem', left: 0, right: 0, textAlign: 'center', fontSize: '.6875rem', color: '#767A82' })}>Camera view</div>
          <div style={frame('7.5rem', '1.75rem', '2px solid #fff')} />
          <div style={tag('6rem', '1.75rem', { background: '#1450F5', color: '#fff', fontWeight: 600 })}>D-05-04 · 12 pcs</div>
          <div style={frame('7.5rem', '10.6rem', '1px dashed #A1B9FB')} />
          <div style={tag('6rem', '10.6rem')}>D-06-04 · 82%</div>
          <div style={frame('15rem', '1.75rem', '1px dashed #A1B9FB')} />
          <div style={tag('13.5rem', '1.75rem')}>D-05-03 · 40%</div>
          <div style={frame('15rem', '10.6rem', '2px solid #C8312B')} />
          <div style={tag('13.5rem', '10.6rem', { background: '#C8312B', color: '#fff', fontWeight: 600 })}>Count due</div>
          <div style={abs({ left: 0, right: 0, bottom: 0, background: '#fff', padding: '1.25rem 1.25rem 1.5rem', display: 'flex', flexDirection: 'column', gap: '.75rem' })}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', fontSize: '.75rem', color: '#767A82', whiteSpace: 'nowrap' }}><span>Put-away · task 3 of 8</span><span>Offline · 3 queued</span></div>
            <div style={{ fontSize: '1.125rem', fontWeight: 600, lineHeight: 1.25 }}>20 × Door operator actuator</div>
            <div style={{ fontSize: '.8125rem', color: '#4A4D55' }}>KM-DX-ACT-220 rev C · PO 4500182 → bin D-05-04</div>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <span className="btn primary" style={{ flex: 1, minHeight: '3rem' }}>Scan bin to confirm</span>
              <span className="btn" style={{ minHeight: '3rem' }}>Skip</span>
            </div>
          </div>
        </div></div>

        <div className="phone"><div className="scr" style={{ background: '#F7F8FA', display: 'flex', flexDirection: 'column' }}>
          <div style={{ height: '2.75rem', flex: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 1.375rem', fontSize: '.75rem', fontWeight: 600, background: '#fff' }}>
            <span>09:41</span><span>KONE</span>
          </div>
          <div style={{ padding: '.5rem 1.25rem 1rem', background: '#fff', borderBottom: '1px solid #DEE0E4' }}>
            <span className="eb">Electronics store · L1</span>
            <div style={{ fontSize: '1.375rem', fontWeight: 600, marginTop: '.25rem' }}>My tasks</div>
            <div className="chips" style={{ marginTop: '.625rem' }}>
              <span className="chip dark">All 8</span><span className="chip">Pick 3</span><span className="chip">Put-away 4</span><span className="chip">Count 1</span>
            </div>
          </div>
          <div style={{ margin: '.75rem 1rem 0', padding: '.625rem .75rem', background: '#FFE141', fontSize: '.75rem' }}>Offline · 3 scans queued, will sync automatically</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.5rem', padding: '.75rem 1rem' }}>
            <div style={card}>
              <div style={cardHead}><span>Pick · due 10:30</span><span>A-02-03</span></div>
              <div style={cardTitle}>10 × MonoSpace controller board</div><div style={cardSub}>For Lab L-03 · prototype build</div>
            </div>
            <div style={{ ...card, border: '2px solid #1450F5', padding: '.8rem' }}>
              <div style={{ ...cardHead, color: '#1450F5', fontWeight: 600 }}><span>Put-away · in progress</span><span>D-05-04</span></div>
              <div style={cardTitle}>20 × Door operator actuator</div><div style={cardSub}>PO 4500182 · Blue Dart inbound</div>
            </div>
            <div style={card}>
              <div style={{ ...cardHead, color: '#C8312B' }}><span>Cycle count · variance</span><span>C-10-04</span></div>
              <div style={cardTitle}>IoT gateway PCB</div><div style={cardSub}>System 40 · last scan 36</div>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ margin: '0 1rem 1.25rem' }} className="btn primary">Scan</div>
        </div></div>
      </div>
    </section>
  );
}
