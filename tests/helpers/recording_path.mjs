export class RecordingPath {
  commands = [];
  moveTo(...args) { this.commands.push(["moveTo", ...args]); }
  lineTo(...args) { this.commands.push(["lineTo", ...args]); }
  closePath(...args) { this.commands.push(["closePath", ...args]); }
  arc(...args) { this.commands.push(["arc", ...args]); }
}
