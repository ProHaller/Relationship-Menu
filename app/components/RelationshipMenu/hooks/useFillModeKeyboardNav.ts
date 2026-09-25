import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MenuCategory, MenuMode, RatingValue } from '../../../types';

export type ActiveCell = { catIndex: number; itemIndex: number };

interface UseFillModeKeyboardNavOptions {
  menu: MenuCategory[];
  mode: MenuMode;
  onIconChange: (catIndex: number, itemIndex: number, newIcon: string | null) => void;
}

interface UseFillModeKeyboardNavResult {
  isActive: (catIndex: number, itemIndex: number) => boolean;
  registerRowRef: (catIndex: number, itemIndex: number) => (el: HTMLDivElement | null) => void;
  onRowFocus: (catIndex: number, itemIndex: number) => void;
  onRowMouseEnter: (catIndex: number, itemIndex: number) => void;
  onRowMouseLeave: (catIndex: number, itemIndex: number) => void;
}

const ROW_ID_PATTERN = /^item-row-(\d+)-(\d+)$/;

const RATING_DIGIT_MAP: Record<string, RatingValue> = {
  '1': 'must',
  '2': 'like',
  '3': 'maybe',
  '4': 'prefer-not',
  '5': 'off-limit',
  '0': null,
};

const RATING_LETTER_MAP: Record<string, RatingValue> = {
  y: 'must',
  w: 'like',
  m: 'maybe',
  n: 'prefer-not',
  o: 'off-limit',
  r: null,
};

const cellKey = (catIndex: number, itemIndex: number) => `${catIndex}-${itemIndex}`;

export function useFillModeKeyboardNav({
  menu,
  mode,
  onIconChange,
}: UseFillModeKeyboardNavOptions): UseFillModeKeyboardNavResult {
  // `activeCell` is sticky (drives roving tabIndex: it's "the row focus should
  // resume at", and must survive focus moving away, e.g. into a note editor or
  // a closing picker unmounting its focused button) — kept as state since it
  // affects render (tabIndex). `hoveredCellRef` is a plain ref (hover never
  // affects render) used as the fallback when nothing is currently focused.
  //
  // Note: which row is *currently* focused is deliberately NOT tracked via
  // onBlur/state. When the IconPicker closes (Escape), it unmounts its
  // auto-focused option button; browsers don't reliably bubble a focusout for
  // a focused node that's being removed, so a blur-tracked "is focused" ref
  // can get stuck true after focus has actually silently moved to <body>. The
  // keydown handler instead re-checks document.activeElement live, which is
  // always correct.
  const [activeCell, setActiveCell] = useState<ActiveCell | null>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const hoveredCellRef = useRef<ActiveCell | null>(null);

  const flatList = useMemo<ActiveCell[]>(
    () => menu.flatMap((category, catIndex) => category.items.map((_, itemIndex) => ({ catIndex, itemIndex }))),
    [menu]
  );

  const firstCell = flatList[0] ?? null;

  const findFlatIndex = useCallback(
    (cell: ActiveCell) => flatList.findIndex((c) => c.catIndex === cell.catIndex && c.itemIndex === cell.itemIndex),
    [flatList]
  );

  const nextItem = useCallback(
    (cell: ActiveCell): ActiveCell | undefined => flatList[findFlatIndex(cell) + 1],
    [flatList, findFlatIndex]
  );

  const prevItem = useCallback(
    (cell: ActiveCell): ActiveCell | undefined => {
      const i = findFlatIndex(cell);
      return i > 0 ? flatList[i - 1] : undefined;
    },
    [flatList, findFlatIndex]
  );

  const jumpPrevCategory = useCallback(
    (cell: ActiveCell): ActiveCell | undefined => {
      for (let c = cell.catIndex - 1; c >= 0; c--) {
        if (menu[c].items.length > 0) return { catIndex: c, itemIndex: 0 };
      }
      return firstCell ?? undefined;
    },
    [menu, firstCell]
  );

  const jumpNextCategory = useCallback(
    (cell: ActiveCell): ActiveCell | undefined => {
      for (let c = cell.catIndex + 1; c < menu.length; c++) {
        if (menu[c].items.length > 0) return { catIndex: c, itemIndex: 0 };
      }
      return flatList[flatList.length - 1];
    },
    [menu, flatList]
  );

  const focusRow = useCallback((cell: ActiveCell) => {
    rowRefs.current.get(cellKey(cell.catIndex, cell.itemIndex))?.focus();
  }, []);

  useEffect(() => {
    if (mode !== 'fill') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const active = document.activeElement;
      // Only defer to the icon picker's own keyboard handling when focus is
      // actually inside it. The picker can also be open merely because the
      // pointer is hovering a tile (no focus change), which must not block
      // row shortcuts elsewhere in the list.
      if (active instanceof HTMLElement && active.closest('[role="dialog"]')) return;

      let cell: ActiveCell | null = null;
      if (active instanceof HTMLElement) {
        const isRowWrapper = active.hasAttribute('data-item-row');
        const isTextInput = active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable;
        if (isTextInput && !isRowWrapper) return;

        const focusedRow = active.closest('[data-item-row]');
        const match = focusedRow instanceof HTMLElement ? focusedRow.id.match(ROW_ID_PATTERN) : null;
        if (match) cell = { catIndex: Number(match[1]), itemIndex: Number(match[2]) };
      }
      if (!cell) cell = hoveredCellRef.current;
      if (!cell) return;

      const key = e.key;
      const lowerKey = key.length === 1 ? key.toLowerCase() : key;

      const ratingValue = key in RATING_DIGIT_MAP ? RATING_DIGIT_MAP[key] : RATING_LETTER_MAP[lowerKey];
      if (ratingValue !== undefined) {
        e.preventDefault();
        const item = menu[cell.catIndex]?.items[cell.itemIndex];
        if (!item || item.icon === 'talk') return;
        const current = item.icon === undefined ? null : item.icon;
        onIconChange(cell.catIndex, cell.itemIndex, current === ratingValue ? null : ratingValue);
        return;
      }

      let target: ActiveCell | undefined;
      if (key === 'ArrowDown' || lowerKey === 'j') target = nextItem(cell);
      else if (key === 'ArrowUp' || lowerKey === 'k') target = prevItem(cell);
      else if (key === 'ArrowLeft' || lowerKey === 'h') target = jumpPrevCategory(cell);
      else if (key === 'ArrowRight' || lowerKey === 'l') target = jumpNextCategory(cell);
      else return;

      e.preventDefault();
      if (target) focusRow(target);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [mode, menu, onIconChange, nextItem, prevItem, jumpPrevCategory, jumpNextCategory, focusRow]);

  const isActive = useCallback(
    (catIndex: number, itemIndex: number) => {
      if (activeCell) return activeCell.catIndex === catIndex && activeCell.itemIndex === itemIndex;
      return firstCell !== null && firstCell.catIndex === catIndex && firstCell.itemIndex === itemIndex;
    },
    [activeCell, firstCell]
  );

  const registerRowRef = useCallback(
    (catIndex: number, itemIndex: number) => (el: HTMLDivElement | null) => {
      const key = cellKey(catIndex, itemIndex);
      if (el) rowRefs.current.set(key, el);
      else rowRefs.current.delete(key);
    },
    []
  );

  const onRowFocus = useCallback((catIndex: number, itemIndex: number) => {
    setActiveCell({ catIndex, itemIndex });
  }, []);

  const onRowMouseEnter = useCallback((catIndex: number, itemIndex: number) => {
    hoveredCellRef.current = { catIndex, itemIndex };
  }, []);

  const onRowMouseLeave = useCallback((catIndex: number, itemIndex: number) => {
    const current = hoveredCellRef.current;
    if (current && current.catIndex === catIndex && current.itemIndex === itemIndex) {
      hoveredCellRef.current = null;
    }
  }, []);

  return { isActive, registerRowRef, onRowFocus, onRowMouseEnter, onRowMouseLeave };
}
