/**
 * Copyright (c) 2017-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @flow strict-local
 * @format
 */

import type {ConsoleIO} from './ConsoleIO';

import LineEditor from './console/LineEditor';
import CommandDispatcher from './CommandDispatcher';
import {Observable, Subject} from 'rxjs';

const PROMPT = 'fbdbg> ';

export default class CommandLine implements ConsoleIO {
  _dispatcher: CommandDispatcher;
  _cli: LineEditor;
  _inputStopped = false;
  _keepPromptWhenStopped: boolean = false;
  _shouldPrompt = false;
  _lastLine = '';
  _overridePrompt: ?string = null;

  _interrupts: Subject<void>;
  _lines: Subject<string>;
  _keys: Subject<string>;

  _subscriptions: Array<rxjs$ISubscription> = [];

  constructor(
    dispatcher: CommandDispatcher,
    plain: boolean,
    logger: log4js$Logger,
  ) {
    this._dispatcher = dispatcher;

    let lineEditorArgs = {
      input: process.stdin,
      output: process.stdout,
    };
    if (plain) {
      lineEditorArgs = {
        ...lineEditorArgs,
        tty: false,
      };
    }
    this._cli = new LineEditor(lineEditorArgs, logger);

    this.setPrompt();

    this._interrupts = new Subject();
    this._subscriptions.push(
      Observable.fromEvent(this._cli, 'SIGINT').subscribe(this._interrupts),
    );

    this._lines = new Subject();
    this._subscriptions.push(
      Observable.fromEvent(this._cli, 'line')
        .takeUntil(Observable.fromEvent(this._cli, 'close'))
        .subscribe(this._lines),
    );

    this._subscriptions.push(
      this._lines
        .filter(_ => !this._inputStopped)
        .switchMap(_ => {
          this._lastLine = _.trim() === '' ? this._lastLine : _.trim();
          try {
            return this._dispatcher.execute(this._lastLine);
          } catch (err) {
            return err;
          }
        })
        .subscribe(_ => {
          if (_ != null) {
            this.outputLine(_.message);
          }
          if (!this._inputStopped) {
            this._cli.prompt();
          } else {
            this._shouldPrompt = true;
          }
        }),
    );

    this._keys = new Subject();
    this._subscriptions.push(
      Observable.fromEvent(this._cli, 'key')
        .takeUntil(Observable.fromEvent(this._cli, 'close'))
        .subscribe(this._keys),
    );

    this._subscriptions.push(
      Observable.fromEvent(this._cli, 'close').subscribe(() => process.exit(1)),
    );

    this._shouldPrompt = true;
  }

  dispose() {
    this._subscriptions.forEach(_ => _.unsubscribe());
  }

  observeInterrupts(): Observable<void> {
    return this._interrupts;
  }

  observeLines(): Observable<string> {
    return this._lines;
  }

  observeKeys(): Observable<string> {
    return this._keys;
  }

  isTTY(): boolean {
    return this._cli.isTTY();
  }

  setPrompt(prompt: ?string): void {
    this._overridePrompt = prompt;
    this._updatePrompt();
  }

  _updatePrompt(): void {
    if (this._inputStopped && !this._keepPromptWhenStopped) {
      this._cli.setPrompt('');
    } else {
      this._cli.setPrompt(
        this._overridePrompt != null ? this._overridePrompt : PROMPT,
      );
    }
  }

  output(text: string): void {
    this._cli.write(text);
  }

  outputLine(line?: string = ''): void {
    this._cli.write(`${line}\n`);
  }

  prompt(): void {
    this._cli.prompt();
  }

  stopInput(keepPromptWhenStopped?: boolean): void {
    this._keepPromptWhenStopped = keepPromptWhenStopped === true;
    this._inputStopped = true;
    this._shouldPrompt = true;
    this._updatePrompt();
  }

  startInput(): void {
    this._inputStopped = false;
    this._updatePrompt();
    if (this._shouldPrompt) {
      this._cli.prompt();
      this._shouldPrompt = false;
    }
  }

  close(error: ?string): void {
    this._cli.close(error);
  }
}
