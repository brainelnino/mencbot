import {describe,it,expect} from 'vitest';
import {metadataNotice} from '@/lib/tenant-format';
describe('image metadata evidence',() => {
  it('never interprets missing metadata as AI',() => expect(metadataNotice({})).toBeNull());
  it('marks explicit AI software as unverified evidence',() => {
    expect(metadataNotice({Software:'ComfyUI'})).toContain('haijathibitishwa');
    expect(metadataNotice({Software:'ComfyUI'})).toContain('AI');
  });
  it('does not label ordinary editing software as AI',() => expect(metadataNotice({Software:'Adobe Photoshop'})).toBeNull());
  it('excludes GPS and creator names',() => expect(metadataNotice({GPSLatitude:'-6.8',Artist:'Personal Name'})).toBeNull());
  it('uses only an existing well-formed date',() => {
    expect(metadataNotice({CreateDate:'2026-11-07T10:39:00Z'})).toContain('2026-11-07T10:39:00Z');
    expect(metadataNotice({CreateDate:'<b>invented</b>'})).toBeNull();
  });
});