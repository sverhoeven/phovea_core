/* *****************************************************************************
 * Caleydo - Visualization for Molecular Biology - http://caleydo.org
 * Copyright (c) The Caleydo Team. All rights reserved.
 * Licensed under the new BSD license, available at http://caleydo.org/license
 **************************************************************************** */
/**
 * Created by Samuel Gratzl on 04.08.2014.
 */

import {argSort, argFilter} from './index';
import {getAPIJSON} from './ajax';
import {all, Range, range, CompositeRange1D, list as rlist, asUngrouped, composite, parse} from './range';
import {SelectAble, resolve, IDType} from './idtype';
import {
  IDataDescription,
  categorical2partitioning,
  IValueType,
  IValueTypeDesc,
  ICategorical2PartitioningOptions,
  ICategory,
  IDataType,
  mask,
  DataTypeBase,
  ICategoricalValueTypeDesc,
  INumberValueTypeDesc,
  VALUE_TYPE_CATEGORICAL,
  VALUE_TYPE_INT,
  VALUE_TYPE_REAL
} from './datatype';
import {computeStats, IStatistics, IHistogram, categoricalHist, hist, rangeHist} from './math';
import {IVector, IVectorDataDescription} from './vector';
import {IStratification, IGroup, StratificationGroup, IStratificationDataDescription} from './stratification';

/**
 * base class for different Vector implementations, views, transposed,...
 */
export abstract class VectorBase extends SelectAble {
  constructor(protected _root: IVector) {
    super();
  }

  get dim() {
    return [this.length];
  }

  abstract data(range?: Range): Promise<any[]>;

  abstract size(): number;

  get length() {
    return this.size();
  }

  view(range: Range = all()): IVector {
    return new VectorView(this._root, range);
  }

  idView(idRange: Range = all()): Promise<IVector> {
    return this.ids().then((ids) => this.view(ids.indexOf(idRange)));
  }

  stats(): Promise<IStatistics> {
    return this.data().then((d) => computeStats(d));
  }

  get indices(): Range {
    return range(0, this.length);
  }

  /**
   * return the range of this vector as a grouped range, depending on the type this might be a single group or multiple ones
   */
  groups(): Promise<CompositeRange1D> {
    const v = this._root.valuetype;
    if (v.type === VALUE_TYPE_CATEGORICAL) {
      const vc = <ICategoricalValueTypeDesc>v;
      return this.data().then((d) => {
        const options: ICategorical2PartitioningOptions = {
          name: this._root.desc.id
        };
        if (typeof vc.categories[0] !== 'string') {
          const vcc = <ICategory[]>vc.categories;
          if (vcc[0].color) {
            options.colors = vcc.map((d) => d.color);
          }
          if (vcc[0].label) {
            options.labels = vcc.map((d) => d.label);
          }
        }
        return categorical2partitioning(d, vc.categories.map((d) => typeof d === 'string' ? d : d.name), options);
      });
    } else {
      return Promise.resolve(composite(this._root.desc.id, [asUngrouped(this.indices.dim(0))]));
    }
  }

  stratification(): Promise<IStratification> {
    return this.groups().then((range) => {
      return new StratificationVector(<IVector><any>this, range);
    });
  }

  hist(bins?: number, range = all()): Promise<IHistogram> {
    const v = this._root.valuetype;
    return this.data(range).then((d) => {
      switch (v.type) {
        case VALUE_TYPE_CATEGORICAL:
          const vc = <ICategoricalValueTypeDesc>v;
          return categoricalHist(d, this.indices.dim(0), d.length, vc.categories.map((d) => typeof d === 'string' ? d : d.name),
            vc.categories.map((d) => typeof d === 'string' ? d : d.name || d.label),
            vc.categories.map((d) => typeof d === 'string' ? 'gray' : d.color || 'gray'));
        case VALUE_TYPE_REAL:
        case VALUE_TYPE_INT:
          const vn = <INumberValueTypeDesc>v;
          return hist(d, this.indices.dim(0), d.length, bins ? bins : Math.round(Math.sqrt(this.length)), vn.range);
        default:
          return null; //cant create hist for unique objects or other ones
      }
    });
  }

  every(callbackfn: (value: IValueType, index: number) => boolean, thisArg?: any): Promise<boolean> {
    return this.data().then((d) => d.every(callbackfn, thisArg));
  }

  some(callbackfn: (value: IValueType, index: number) => boolean, thisArg?: any): Promise<boolean> {
    return this.data().then((d) => d.some(callbackfn, thisArg));
  }

  forEach(callbackfn: (value: IValueType, index: number) => void, thisArg?: any): void {
    this.data().then((d) => d.forEach(callbackfn, thisArg));
  }

  reduce<T,U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number) => U, initialValue: U, thisArg?: any): Promise<U> {
    function helper() {
      return callbackfn.apply(thisArg, Array.from(arguments));
    }

    return this.data().then((d) => d.reduce(helper, initialValue));
  }

  reduceRight<T,U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number) => U, initialValue: U, thisArg?: any): Promise<U> {
    function helper() {
      return callbackfn.apply(thisArg, Array.from(arguments));
    }

    return this.data().then((d) => d.reduceRight(helper, initialValue));
  }

  restore(persisted: any) {
    let r: IVector = <IVector>(<any>this);
    if (persisted && persisted.range) { //some view onto it
      r = r.view(parse(persisted.range));
    }
    return r;
  }
}

export interface IVectorLoader {
  (desc: IVectorDataDescription): Promise<{
    readonly rowIds: Range;
    readonly rows: string[];
    readonly data: IValueType[];
  }>;
}


function viaAPILoader() {
  let _loader = undefined;
  return (desc) => {
    if (_loader) { //in the cache
      return _loader;
    }
    return _loader = getAPIJSON('/dataset/' + desc.id).then((data) => {
      data.rowIds = parse(data.rowIds);
      return data;
    });
  };
}

function viaDataLoader(rows: string[], rowIds: number[], data: IValueType[]) {
  let _data = undefined;
  return () => {
    if (_data) { //in the cache
      return Promise.resolve(_data);
    }
    _data = {
      rowIds: parse(rowIds),
      rows: rows,
      data: data
    };
    return Promise.resolve(_data);
  };
}

/**
 * root matrix implementation holding the data
 */
export class Vector extends VectorBase implements IVector {

  constructor(public readonly desc: IVectorDataDescription, private loader: IVectorLoader) {
    super(null);
    this._root = this;
  }

  get valuetype() {
    return this.desc.value;
  }

  get idtype() {
    return resolve(this.desc.idtype);
  }

  /**
   * loads all the underlying data in json format
   * TODO: load just needed data and not everything given by the requested range
   * @returns {*}
   */
  private load(): Promise<any> {
    return this.loader(this.desc);
  }

  /**
   * access at a specific position
   * @param i
   * @returns {*}
   */
  at(i: number) {
    return this.load().then((d) => d.data[i]);
  }

  data(range: Range = all()) {
    return this.load().then((data) => {
      const d = range.filter(data.data, this.dim);
      if (this.valuetype.type === VALUE_TYPE_REAL || this.valuetype.type === VALUE_TYPE_INT) {
        return mask(d, <INumberValueTypeDesc>this.valuetype);
      }
      return d;
    });
  }

  names(range: Range = all()) {
    return this.load().then((data) => {
      return range.filter(data.rows, this.dim);
    });
  }

  ids(range: Range = all()): Promise<Range> {
    return this.load().then((data) => data.rowIds.preMultiply(range, this.dim));
  }

  get idtypes() {
    return [this.idtype];
  }

  size() {
    return this.desc.size;
  }

  sort(compareFn?: (a: IValueType, b: IValueType) => number, thisArg?: any): Promise<IVector> {
    return this.data().then((d) => {
      const indices = argSort(d, compareFn, thisArg);
      return this.view(rlist(indices));
    });
  }

  map<U>(callbackfn: (value: IValueType, index: number) => U, thisArg?: any): Promise<IVector> {
    //FIXME
    return null;
  }

  filter(callbackfn: (value: IValueType, index: number) => boolean, thisArg?: any): Promise<IVector> {
    return this.data().then((d) => {
      const indices = argFilter(d, callbackfn, thisArg);
      return this.view(rlist(indices));
    });
  }

  persist() {
    return this.desc.id;
  }
}

/**
 * view on the vector restricted by a range
 * @param root underlying matrix
 * @param range range selection
 * @param t optional its transposed version
 * @constructor
 */
class VectorView extends VectorBase implements IVector {
  constructor(root: IVector, private range: Range) {
    super(root);
  }

  get desc() {
    return this._root.desc;
  }

  persist() {
    return {
      root: this._root.persist(),
      range: this.range.toString()
    };
  }

  size() {
    return this.range.size(this._root.dim)[0];
  }

  at(i: number) {
    const inverted = this.range.invert([i], this._root.dim);
    return this._root.at(inverted[0]);
  }

  data(range: Range = all()) {
    return this._root.data(this.range.preMultiply(range, this._root.dim));
  }

  names(range: Range = all()) {
    return this._root.names(this.range.preMultiply(range, this._root.dim));
  }

  ids(range: Range = all()) {
    return this._root.ids(this.range.preMultiply(range, this._root.dim));
  }

  view(range: Range = all()) {
    if (range.isAll) {
      return this;
    }
    return new VectorView(this._root, this.range.preMultiply(range, this.dim));
  }

  get valuetype() {
    return this._root.valuetype;
  }

  get idtype() {
    return this._root.idtype;
  }

  get idtypes() {
    return [this.idtype];
  }

  /*get indices() {
   return this.range;
   }*/

  sort(compareFn?: (a: IValueType, b: IValueType) => number, thisArg?: any): Promise<IVector> {
    return this.data().then((d) => {
      const indices = argSort(d, compareFn, thisArg);
      return this.view(this.range.preMultiply(rlist(indices)));
    });
  }

  map<U>(callbackfn: (value: IValueType, index: number) => U, thisArg?: any): Promise<IVector> {
    //FIXME
    return null;
  }

  filter(callbackfn: (value: IValueType, index: number) => boolean, thisArg?: any): Promise<IVector> {
    return this.data().then((d) => {
      const indices = argFilter(d, callbackfn, thisArg);
      return this.view(this.range.preMultiply(rlist(indices)));
    });
  }
}


/**
 * root matrix implementation holding the data
 */
export class StratificationVector extends DataTypeBase<IStratificationDataDescription> implements IStratification {

  constructor(private v: IVector, private r: CompositeRange1D) {
    super({
      id: v.desc.id + '-s',
      name: v.desc.name,
      fqname: v.desc.fqname,
      type: 'stratification',
      size: v.dim,
      ngroups: r.groups.length,
      groups: r.groups.map((ri) => ({name: ri.name, color: ri.color, size: ri.length}))
    });
  }

  get idtype() {
    return this.v.idtype;
  }

  get groups() {
    return <IGroup[]>(<any>this.desc).groups;
  }

  group(group: number): IStratification {
    return new StratificationGroup(this, group, this.groups[group]);
  }

  hist(bins?: number, range = all()): Promise<IHistogram> {
    return this.range().then((r) => {
      return rangeHist(r);
    });
  }

  vector() {
    return Promise.resolve(this.v);
  }

  origin(): Promise<IDataType> {
    return this.vector();
  }

  range() {
    return Promise.resolve(this.r);
  }

  idRange() {
    return this.ids().then((ids) => {
      return ids.dim(0).preMultiply(this.r, this.dim[0]);
    });
  }

  names(range: Range = all()) {
    return this.v.names(range);
  }

  ids(range: Range = all()): Promise<Range> {
    return this.v.ids(range);
  }

  get idtypes() {
    return [this.idtype];
  }

  size() {
    return this.size;
  }

  get length() {
    return this.size()[0];
  }

  get ngroups() {
    return this.ngroups;
  }

  get dim() {
    return this.size();
  }

  persist() {
    return {
      root: this.v.persist(),
      asstrat: true
    };
  }
}


/**
 * module entry point for creating a datatype
 * @param desc
 * @returns {IVector}
 */
export function create(desc: IVectorDataDescription): IVector {
  if (typeof((<any>desc).loader) === 'function') {
    return new Vector(desc, <IVectorLoader>(<any>desc).loader);
  }
  return new Vector(desc, viaAPILoader());
}

export function wrap(desc: IVectorDataDescription, rows: string[], rowIds: number[], data: IValueType[]) {
  return new Vector(desc, viaDataLoader(rows, rowIds, data));
}