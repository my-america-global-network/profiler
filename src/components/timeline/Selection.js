/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// @flow

import * as React from 'react';
import clamp from 'clamp';
import { getContentRect } from '../../utils/css-geometry-tools';
import {
  getProfileInterval,
  getPreviewSelection,
  getCommittedRange,
  getZeroAt,
} from '../../selectors/profile';
import {
  updatePreviewSelection,
  commitRange,
} from '../../actions/profile-view';
import explicitConnect from '../../utils/connect';
import classNames from 'classnames';
import Draggable from '../shared/Draggable';
import { getFormattedTimeLength } from '../../profile-logic/committed-ranges';
import './Selection.css';

import type { OnMove } from '../shared/Draggable';
import type { Milliseconds, CssPixels, StartEndRange } from '../../types/units';
import type { PreviewSelection } from '../../types/actions';
import type {
  ExplicitConnectOptions,
  ConnectedProps,
} from '../../utils/connect';

type MouseHandler = (event: MouseEvent) => void;

type OwnProps = {|
  +width: number,
  +children: React.Node,
|};

type StateProps = {|
  +previewSelection: PreviewSelection,
  +committedRange: StartEndRange,
  +zeroAt: Milliseconds,
  +minSelectionStartWidth: Milliseconds,
|};

type DispatchProps = {|
  +commitRange: typeof commitRange,
  +updatePreviewSelection: typeof updatePreviewSelection,
|};

type Props = ConnectedProps<OwnProps, StateProps, DispatchProps>;

type State = {|
  hoverLocation: null | CssPixels,
|};

class TimelineRulerAndSelection extends React.PureComponent<Props, State> {
  _handlers: ?{
    mouseMoveHandler: MouseHandler,
    mouseUpHandler: MouseHandler,
  };

  _container: ?HTMLElement;
  _rangeStartOnMove: OnMove;
  _moveRangeOnMove: OnMove;
  _rangeEndOnMove: OnMove;

  state = {
    hoverLocation: null,
  };

  _containerCreated = (element: HTMLElement | null) => {
    this._container = element;
  };

  _onMouseDown = (event: SyntheticMouseEvent<>) => {
    if (!this._container || event.button !== 0) {
      return;
    }

    const rect = getContentRect(this._container);
    if (
      event.pageX < rect.left ||
      event.pageX >= rect.right ||
      event.pageY < rect.top ||
      event.pageY >= rect.bottom
    ) {
      return;
    }

    // Don't steal focus. The -moz-user-focus: ignore declaration achieves
    // this more reliably in Gecko, so this preventDefault is mostly for other
    // browsers.
    event.preventDefault();

    const { committedRange, minSelectionStartWidth } = this.props;
    const mouseDownTime =
      ((event.pageX - rect.left) / rect.width) *
        (committedRange.end - committedRange.start) +
      committedRange.start;

    let isRangeSelecting = false;

    const mouseMoveHandler = event => {
      const mouseMoveTime =
        ((event.pageX - rect.left) / rect.width) *
          (committedRange.end - committedRange.start) +
        committedRange.start;
      const selectionStart = clamp(
        Math.min(mouseDownTime, mouseMoveTime),
        committedRange.start,
        committedRange.end
      );
      const selectionEnd = clamp(
        Math.max(mouseDownTime, mouseMoveTime),
        committedRange.start,
        committedRange.end
      );
      if (
        isRangeSelecting ||
        selectionEnd - selectionStart >= minSelectionStartWidth
      ) {
        isRangeSelecting = true;
        this.props.updatePreviewSelection({
          hasSelection: true,
          selectionStart,
          selectionEnd,
          isModifying: true,
        });
      }
    };

    const mouseUpHandler = event => {
      if (isRangeSelecting) {
        const mouseMoveTime =
          ((event.pageX - rect.left) / rect.width) *
            (committedRange.end - committedRange.start) +
          committedRange.start;
        const selectionStart = clamp(
          Math.min(mouseDownTime, mouseMoveTime),
          committedRange.start,
          committedRange.end
        );
        const selectionEnd = clamp(
          Math.max(mouseDownTime, mouseMoveTime),
          committedRange.start,
          committedRange.end
        );
        this.props.updatePreviewSelection({
          hasSelection: true,
          selectionStart,
          selectionEnd,
          isModifying: false,
        });
        event.stopPropagation();
        this._uninstallMoveAndUpHandlers();
        return;
      }

      const { previewSelection } = this.props;
      if (previewSelection.hasSelection) {
        const mouseUpTime =
          ((event.pageX - rect.left) / rect.width) *
            (committedRange.end - committedRange.start) +
          committedRange.start;
        const { selectionStart, selectionEnd } = previewSelection;
        if (mouseUpTime < selectionStart || mouseUpTime >= selectionEnd) {
          // Unset preview selection.
          this.props.updatePreviewSelection({
            hasSelection: false,
            isModifying: false,
          });
        }
      }

      // Do not stopPropagation(), so that graph gets mouseup event.
      this._uninstallMoveAndUpHandlers();
    };

    this._installMoveAndUpHandlers(mouseMoveHandler, mouseUpHandler);
  };

  _installMoveAndUpHandlers(
    mouseMoveHandler: MouseHandler,
    mouseUpHandler: MouseHandler
  ) {
    this._handlers = { mouseMoveHandler, mouseUpHandler };
    window.addEventListener('mousemove', mouseMoveHandler, true);
    window.addEventListener('mouseup', mouseUpHandler, true);
  }

  _uninstallMoveAndUpHandlers() {
    if (this._handlers) {
      const { mouseMoveHandler, mouseUpHandler } = this._handlers;
      window.removeEventListener('mousemove', mouseMoveHandler, true);
      window.removeEventListener('mouseup', mouseUpHandler, true);
    }
  }

  _onMouseMove = (event: SyntheticMouseEvent<>) => {
    if (!this._container) {
      return;
    }

    const rect = getContentRect(this._container);
    if (
      event.pageX < rect.left ||
      event.pageX >= rect.right ||
      event.pageY < rect.top ||
      event.pageY >= rect.bottom
    ) {
      this.setState({ hoverLocation: null });
    } else {
      this.setState({ hoverLocation: event.pageX - rect.left });
    }
  };

  _makeOnMove = (fun: number => { startDelta: number, endDelta: number }) => (
    originalSelection: { +selectionStart: number, +selectionEnd: number },
    dx: number,
    dy: number,
    isModifying: boolean
  ) => {
    const { committedRange, width, updatePreviewSelection } = this.props;
    const delta = (dx / width) * (committedRange.end - committedRange.start);
    const selectionDeltas = fun(delta);
    const selectionStart = Math.max(
      committedRange.start,
      originalSelection.selectionStart + selectionDeltas.startDelta
    );
    const selectionEnd = clamp(
      originalSelection.selectionEnd + selectionDeltas.endDelta,
      selectionStart,
      committedRange.end
    );
    updatePreviewSelection({
      hasSelection: true,
      isModifying,
      selectionStart,
      selectionEnd,
    });
  };

  _rangeStartOnMove = this._makeOnMove(delta => ({
    startDelta: delta,
    endDelta: 0,
  }));

  _moveRangeOnMove = this._makeOnMove(delta => ({
    startDelta: delta,
    endDelta: delta,
  }));

  _rangeEndOnMove = this._makeOnMove(delta => ({
    startDelta: 0,
    endDelta: delta,
  }));

  _zoomButtonOnMouseDown = (e: SyntheticMouseEvent<>) => {
    e.stopPropagation();
  };

  _zoomButtonOnClick = (e: SyntheticMouseEvent<>) => {
    e.stopPropagation();
    const { previewSelection, zeroAt, commitRange } = this.props;
    if (previewSelection.hasSelection) {
      commitRange(
        // $FlowFixMe Error introduced by upgrading to v0.96.0.
        previewSelection.selectionStart - zeroAt,
        previewSelection.selectionEnd - zeroAt
      );
    }
  };

  renderSelectionOverlay(previewSelection: {
    +selectionStart: number,
    +selectionEnd: number,
    +isModifying: boolean,
  }) {
    const { committedRange, width } = this.props;
    const { selectionStart, selectionEnd } = previewSelection;

    const beforeWidth =
      ((selectionStart - committedRange.start) /
        (committedRange.end - committedRange.start)) *
      width;
    const selectionWidth =
      ((selectionEnd - selectionStart) /
        (committedRange.end - committedRange.start)) *
      width;

    return (
      <div className="timelineSelectionOverlay">
        <div
          className="timelineSelectionDimmerBefore"
          style={{ width: `${beforeWidth}px` }}
        />
        <div className="timelineSelectionOverlayWrapper">
          <div
            className="timelineSelectionGrippy"
            style={{ width: `${selectionWidth}px` }}
          >
            <Draggable
              className="timelineSelectionGrippyRangeStart"
              value={previewSelection}
              onMove={this._rangeStartOnMove}
            />
            <Draggable
              className="timelineSelectionGrippyMoveRange"
              value={previewSelection}
              onMove={this._moveRangeOnMove}
            />
            <Draggable
              className="timelineSelectionGrippyRangeEnd"
              value={previewSelection}
              onMove={this._rangeEndOnMove}
            />
          </div>
          <div className="timelineSelectionOverlayInner">
            <span
              className={classNames('timelineSelectionOverlayRange', {
                hidden: !previewSelection.isModifying,
              })}
            >
              {getFormattedTimeLength(selectionEnd - selectionStart)}
            </span>
            <button
              className={classNames('timelineSelectionOverlayZoomButton', {
                hidden: previewSelection.isModifying,
              })}
              type="button"
              onMouseDown={this._zoomButtonOnMouseDown}
              onClick={this._zoomButtonOnClick}
            />
          </div>
        </div>
        <div className="timelineSelectionDimmerAfter" />
      </div>
    );
  }

  render() {
    const { children, previewSelection } = this.props;
    const { hoverLocation } = this.state;

    return (
      <div
        className="timelineSelection"
        ref={this._containerCreated}
        onMouseDown={this._onMouseDown}
        onMouseMove={this._onMouseMove}
      >
        {children}
        {previewSelection.hasSelection
          ? this.renderSelectionOverlay(previewSelection)
          : null}
        <div
          className="timelineSelectionHoverLine"
          style={{
            visibility:
              previewSelection.isModifying || hoverLocation === null
                ? 'hidden'
                : undefined,
            left: hoverLocation === null ? '0' : `${hoverLocation}px`,
          }}
        />
      </div>
    );
  }
}

// $FlowFixMe Error introduced by upgrading to v0.96.0.
const options: ExplicitConnectOptions<OwnProps, StateProps, DispatchProps> = {
  mapStateToProps: state => ({
    previewSelection: getPreviewSelection(state),
    committedRange: getCommittedRange(state),
    zeroAt: getZeroAt(state),
    minSelectionStartWidth: getProfileInterval(state),
  }),
  mapDispatchToProps: {
    updatePreviewSelection,
    commitRange,
  },
  component: TimelineRulerAndSelection,
};

// $FlowFixMe Error introduced by upgrading to v0.96.0.
export default explicitConnect(options);
