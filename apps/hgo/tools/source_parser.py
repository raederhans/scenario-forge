"""Small source-only Clausewitz reader. No dependency on the main map compiler."""
from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass
class Block:
    entries: list

    def all(self, key):
        return [value for name, value in self.entries if name == key]

    def get(self, key, default=None):
        values = self.all(key)
        return values[-1] if values else default

    def values(self):
        return [value for name, value in self.entries if name is None]


@dataclass
class Tagged:
    kind: str
    block: Block


TOKEN = re.compile(r'\s+|\#[^\n]*|"(?:\\.|[^"\\])*"|[{}=]|[^\s{}=#"]+')


def parse(text: str) -> Block:
    tokens = []
    end = 0
    for match in TOKEN.finditer(text.lstrip('\ufeff')):
        token = match.group()
        if match.start() != end:
            raise ValueError('Malformed source token')
        end = match.end()
        if token.isspace() or token.startswith('#'):
            continue
        if token.startswith('"'):
            token = re.sub(r'\\(["\\])', r'\1', token[1:-1])
        tokens.append(token)
    if end != len(text.lstrip('\ufeff')):
        raise ValueError('Unterminated source string')
    cursor = 0

    def value():
        nonlocal cursor
        if cursor >= len(tokens):
            raise ValueError('Missing source value')
        token = tokens[cursor]
        cursor += 1
        if token == '{':
            return block(True)
        if token in ('}', '='):
            raise ValueError('Unexpected source delimiter')
        if cursor < len(tokens) and tokens[cursor] == '{':
            cursor += 1
            return Tagged(token, block(True))
        return token

    def block(nested=False):
        nonlocal cursor
        entries = []
        while cursor < len(tokens):
            if tokens[cursor] == '}':
                if not nested:
                    raise ValueError('Unexpected closing brace')
                cursor += 1
                return Block(entries)
            item = value()
            if cursor < len(tokens) and tokens[cursor] == '=':
                cursor += 1
                if not isinstance(item, str):
                    raise ValueError('Invalid assignment key')
                entries.append((item, value()))
            else:
                entries.append((None, item))
        if nested:
            raise ValueError('Unclosed source block')
        return Block(entries)

    return block()


def date_tuple(value):
    if isinstance(value, str) and re.fullmatch(r'\d{4}\.\d{1,2}\.\d{1,2}', value):
        return tuple(map(int, value.split('.')))
    return None


def history_at(history: Block, date=(1936, 1, 1)) -> Block:
    """Base assignments plus dated blocks, without treating triggers as history."""
    entries = [(k, v) for k, v in history.entries if date_tuple(k) is None]
    dated = sorted((date_tuple(k), v) for k, v in history.entries
                   if date_tuple(k) and date_tuple(k) <= date and isinstance(v, Block))
    for _, item in dated:
        entries.extend(item.entries)
    return Block(entries)


def color_hex(value):
    import colorsys
    kind = value.kind.lower() if isinstance(value, Tagged) else 'rgb'
    body = value.block if isinstance(value, Tagged) else value
    if not isinstance(body, Block) or len(body.values()) != 3:
        return None
    rgb = list(map(float, body.values()))
    if kind == 'hsv':
        rgb = [v * 255 for v in colorsys.hsv_to_rgb(*rgb)]
    elif kind != 'rgb':
        return None
    if not all(0 <= channel <= 255 for channel in rgb):
        raise ValueError('Source color out of range')
    return '#' + ''.join(f'{round(channel):02x}' for channel in rgb)
