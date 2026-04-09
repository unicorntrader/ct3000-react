import React, { useState } from 'react';
import { dailyDays } from '../data/mockData';

const statusStyles = {
  matched: 'bg-blue-50 text-blue-600',
  unmatched: 'bg-amber-100 text-amber-700',
  ambiguous: 'bg-purple-50 text-purple-700',
  opt: 'bg-green-50 text-green-700',
};

function DayBlock({ day }) {
  const [note, setNote] = useState(day.note);
  const [editingNote, setEditingNote] = useState(false);
  const [noteInput, setNoteInput] = useState(day.note || '');
  const [journalInput, setJournalInput] = useState('');
  const [resolved, setResolved] = useState({});
  const [openResolve, setOpenResolve] = useState(null);

  const handleSaveNote = () => {
    setNote(noteInput);
    setEditingNote(false);
  };

  const handleSaveJournal = () => {
    if (!journalInput.trim()) return;
    setNote(journalInput);
  };

  const handleResolve = (id, label) => {
    setResolved(r => ({ ...r, [id]: label }));
    setOpenResolve(null);
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-6">
      <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">{day.date}</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            {day.trades} trades &middot; {day.wins} wins, {day.losses} losses
            {day.needsReview > 0 && (
              <span className="text-amber-600 font-medium"> &middot; {day.needsReview} need review</span>
            )}
          </p>
        </div>
        <div className="text-right">
          <p className={`text-2xl font-bold ${day.positive ? 'text-green-600' : 'text-red-500'}`}>{day.pnl}</p>
          <p className="text-sm text-gray-400">Daily P&L</p>
        </div>
      </div>

      {note && !editingNote && (
        <div className="px-6 py-4 bg-blue-50 border-b border-blue-100">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-semibold text-gray-700">Daily Notes</h4>
            <button
              onClick={() => { setNoteInput(note); setEditingNote(true); }}
              className="flex items-center space-x-1 text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>Edit</span>
            </button>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed">{note}</p>
        </div>
      )}

      {editingNote && (
        <div className="px-6 py-4 bg-blue-50 border-b border-blue-100">
          <textarea
            rows={3}
            value={noteInput}
            onChange={e => setNoteInput(e.target.value)}
            className="w-full text-sm border border-blue-200 rounded-lg p-3 bg-white focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
          />
          <div className="flex space-x-2 mt-2">
            <button onClick={handleSaveNote} className="text-xs bg-blue-600 text-white px-4 py-1.5 rounded-lg font-medium hover:bg-blue-700">Save note</button>
            <button onClick={() => setEditingNote(false)} className="text-xs border border-gray-200 px-4 py-1.5 rounded-lg text-gray-600 hover:bg-gray-50">Cancel</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              {['Time', 'Symbol', 'Entry', 'Exit', 'Qty', 'P&L', 'Status'].map(h => (
                <th key={h} className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {day.rows.map((row, i) => {
              const resolvedStatus = row.resolveId ? resolved[row.resolveId] : null;
              const currentStatus = resolvedStatus || row.status;
              const needsAction = (row.status === 'unmatched' || row.status === 'ambiguous') && !resolvedStatus;

              return (
                <React.Fragment key={i}>
                  <tr className={needsAction ? 'bg-amber-50' : 'hover:bg-gray-50'}>
                    <td className="px-6 py-4 text-sm text-gray-600">{row.time}</td>
                    <td className="px-6 py-4 text-sm font-medium text-gray-900">{row.symbol}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{row.entry}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{row.exit}</td>
                    <td className="px-6 py-4 text-sm text-gray-900">{row.qty}</td>
                    <td className={`px-6 py-4 text-sm font-medium ${row.positive ? 'text-green-600' : 'text-red-500'}`}>{row.pnl}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center space-x-2">
                        <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${statusStyles[currentStatus] || 'bg-gray-100 text-gray-500'}`}>
                          {resolvedStatus || (currentStatus.charAt(0).toUpperCase() + currentStatus.slice(1))}
                        </span>
                        {needsAction && (
                          <button
                            onClick={() => setOpenResolve(openResolve === row.resolveId ? null : row.resolveId)}
                            className="text-xs text-blue-600 font-medium hover:underline whitespace-nowrap"
                          >
                            Resolve &rarr;
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>

                  {needsAction && openResolve === row.resolveId && (
                    <tr className="bg-amber-50">
                      <td colSpan={7} className="px-6 py-3">
                        <div className={`bg-white rounded-xl p-4 border ${row.status === 'ambiguous' ? 'border-purple-200' : 'border-amber-200'}`}>
                          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                            Resolve {row.symbol} &middot; {row.pnl}
                          </p>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-3">
                            {row.status === 'unmatched' ? (
                              <>
                                <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:border-blue-400">
                                  <input type="radio" name={`resolve-${row.resolveId}`} className="mt-0.5" />
                                  <div><p className="text-sm font-medium text-gray-900">{row.symbol} -- Long &middot; Momentum</p><p className="text-xs text-gray-400 mt-0.5">Created Jul 25 &middot; Entry available</p></div>
                                </label>
                                <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:border-red-300">
                                  <input type="radio" name={`resolve-${row.resolveId}`} className="mt-0.5" />
                                  <div><p className="text-sm font-medium text-gray-900">Mark as unplanned</p><p className="text-xs text-gray-400 mt-0.5">Discretionary trade, no plan</p></div>
                                </label>
                              </>
                            ) : (
                              <>
                                <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:border-blue-400">
                                  <input type="radio" name={`resolve-${row.resolveId}`} className="mt-0.5" />
                                  <div><p className="text-sm font-medium text-gray-900">{row.symbol} -- Long &middot; Support</p><p className="text-xs text-gray-400 mt-0.5">Created Jul 24 &middot; Entry $174</p></div>
                                </label>
                                <label className="flex items-start space-x-3 cursor-pointer p-3 rounded-lg border border-gray-200 hover:border-blue-400">
                                  <input type="radio" name={`resolve-${row.resolveId}`} className="mt-0.5" />
                                  <div><p className="text-sm font-medium text-gray-900">{row.symbol} -- Long &middot; Breakout</p><p className="text-xs text-gray-400 mt-0.5">Created Jul 25 &middot; Entry $176</p></div>
                                </label>
                              </>
                            )}
                          </div>
                          <div className="flex space-x-2">
                            <button onClick={() => handleResolve(row.resolveId, 'Matched')} className="bg-blue-600 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-blue-700">Save</button>
                            <button onClick={() => setOpenResolve(null)} className="border border-gray-200 text-gray-600 text-xs px-4 py-2 rounded-lg hover:bg-gray-50">Cancel</button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {!note && (
        <div className="px-6 py-5 border-t border-gray-100 bg-gray-50">
          <div className="flex items-center space-x-2 mb-3">
            <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            <p className="text-sm font-semibold text-gray-700">How was your day?</p>
          </div>
          <textarea
            value={journalInput}
            onChange={e => setJournalInput(e.target.value)}
            placeholder="What went well? What did you miss? Any patterns you noticed today..."
            rows={3}
            className="w-full text-sm border border-gray-200 rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-400 bg-white resize-none"
          />
          <div className="flex items-center justify-between mt-3">
            <p className="text-xs text-gray-400">This becomes your session log -- visible in Daily View and Journal.</p>
            <button onClick={handleSaveJournal} className="bg-blue-600 text-white text-xs font-medium px-4 py-2 rounded-lg hover:bg-blue-700">Save journal</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DailyViewScreen() {
  return (
    <div>
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div className="relative">
            <svg className="w-4 h-4 absolute left-3 top-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input type="text" placeholder="Search symbols..." className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50" />
          </div>
          <select className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-700">
            <option>All Dates</option>
            <option>Jul 26, 2025</option>
            <option>Jul 25, 2025</option>
          </select>
          <select className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 bg-gray-50 text-gray-700">
            <option>Sort by Date</option>
            <option>Sort by Symbol</option>
            <option>Sort by P&L</option>
          </select>
          <button className="flex items-center justify-center space-x-2 px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-700 bg-gray-50 hover:bg-gray-100">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            <span>Descending</span>
          </button>
        </div>
      </div>

      {dailyDays.map(day => (
        <DayBlock key={day.id} day={day} />
      ))}
    </div>
  );
}
