/* *****************************************************************************
 * Caleydo - Visualization for Molecular Biology - http://caleydo.org
 * Copyright (c) The Caleydo Team. All rights reserved.
 * Licensed under the new BSD license, available at http://caleydo.org/license
 **************************************************************************** */
/**
 * Created by Samuel Gratzl on 04.08.2014.
 */

import {all, list as rlist, Range, RangeLike, range, CompositeRange1D, asUngrouped, composite, parse} from '../range';
import {argSort, argFilter} from '../index';
import {SelectAble} from '../idtype';
import {
  categorical2partitioning,
  ICategorical2PartitioningOptions,
  ICategory,
  ICategoricalValueTypeDesc,
  INumberValueTypeDesc,
  VALUE_TYPE_CATEGORICAL,
  VALUE_TYPE_INT,
  VALUE_TYPE_REAL, IValueTypeDesc
} from '../datatype';
import {computeStats, IStatistics, IHistogram, categoricalHist, hist} from '../math';
import {IVector} from './IVector';
import {IStratification} from '../stratification';
import StratificationVector from './internal/StratificationVector';
/**
 * base class for different Vector implementations, views, transposed,...
 * @internal
 */
export abstract class AVector<T,D extends IValueTypeDesc> extends SelectAble {
  constructor(protected root: IVector<T,D>) {
    super();
  }

  get dim() {
    return [this.length];
  }

  abstract data(range?: RangeLike): Promise<any[]>;

  abstract size(): number;

  get length() {
    return this.size();
  }

  view(range: RangeLike = all()): IVector<T,D> {
    return new VectorView(this.root, parse(range));
  }

  idView(idRange: RangeLike = all()): Promise<IVector<T,D>> {
    return this.ids().then((ids) => this.view(ids.indexOf(parse(idRange))));
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
    const v = this.root.valuetype;
    if (v.type === VALUE_TYPE_CATEGORICAL) {
      const vc = <ICategoricalValueTypeDesc><any>v;
      return this.data().then((d) => {
        const options: ICategorical2PartitioningOptions = {
          name: this.root.desc.id
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
      return Promise.resolve(composite(this.root.desc.id, [asUngrouped(this.indices.dim(0))]));
    }
  }

  stratification(): Promise<IStratification> {
    return this.asStratification();
  }

  asStratification(): Promise<IStratification> {
    return this.groups().then((range) => {
      return new StratificationVector(this.root, range);
    });
  }

  hist(bins?: number, range: RangeLike = all()): Promise<IHistogram> {
    const v = this.root.valuetype;
    return this.data(range).then((d) => {
      switch (v.type) {
        case VALUE_TYPE_CATEGORICAL:
          const vc = <ICategoricalValueTypeDesc><any>v;
          return categoricalHist(d, this.indices.dim(0), d.length, vc.categories.map((d) => typeof d === 'string' ? d : d.name),
            vc.categories.map((d) => typeof d === 'string' ? d : d.name || d.label),
            vc.categories.map((d) => typeof d === 'string' ? 'gray' : d.color || 'gray'));
        case VALUE_TYPE_REAL:
        case VALUE_TYPE_INT:
          const vn = <INumberValueTypeDesc><any>v;
          return hist(d, this.indices.dim(0), d.length, bins ? bins : Math.round(Math.sqrt(this.length)), vn.range);
        default:
          return null; //cant create hist for unique objects or other ones
      }
    });
  }

  every(callbackfn: (value: T, index: number) => boolean, thisArg?: any): Promise<boolean> {
    return this.data().then((d) => d.every(callbackfn, thisArg));
  }

  some(callbackfn: (value: T, index: number) => boolean, thisArg?: any): Promise<boolean> {
    return this.data().then((d) => d.some(callbackfn, thisArg));
  }

  forEach(callbackfn: (value: T, index: number) => void, thisArg?: any): void {
    this.data().then((d) => d.forEach(callbackfn, thisArg));
  }

  reduce<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number) => U, initialValue: U, thisArg?: any): Promise<U> {
    function helper() {
      return callbackfn.apply(thisArg, Array.from(arguments));
    }

    return this.data().then((d) => d.reduce(helper, initialValue));
  }

  reduceRight<U>(callbackfn: (previousValue: U, currentValue: T, currentIndex: number) => U, initialValue: U, thisArg?: any): Promise<U> {
    function helper() {
      return callbackfn.apply(thisArg, Array.from(arguments));
    }

    return this.data().then((d) => d.reduceRight(helper, initialValue));
  }

  restore(persisted: any) {
    let r: IVector<T,D> = <IVector<T,D>>(<any>this);
    if (persisted && persisted.range) { //some view onto it
      r = r.view(parse(persisted.range));
    }
    return r;
  }
}

export default AVector;


/**
 * view on the vector restricted by a range
 * @internal
 */
export class VectorView<T,D extends IValueTypeDesc> extends AVector<T,D> {
  /**
   * @param root underlying matrix
   * @param range range selection
   */
  constructor(root: IVector<T,D>, private range: Range) {
    super(root);
  }

  get desc() {
    return this.root.desc;
  }

  persist() {
    return {
      root: this.root.persist(),
      range: this.range.toString()
    };
  }

  size() {
    return this.range.size(this.root.dim)[0];
  }

  at(i: number) {
    const inverted = this.range.invert([i], this.root.dim);
    return this.root.at(inverted[0]);
  }

  data(range: RangeLike = all()) {
    return this.root.data(this.range.preMultiply(parse(range), this.root.dim));
  }

  names(range: RangeLike = all()) {
    return this.root.names(this.range.preMultiply(parse(range), this.root.dim));
  }

  ids(range: RangeLike = all()) {
    return this.root.ids(this.range.preMultiply(parse(range), this.root.dim));
  }

  view(range: RangeLike = all()) {
    const r = parse(range);
    if (r.isAll) {
      return this;
    }
    return new VectorView(this.root, this.range.preMultiply(r, this.dim));
  }

  get valuetype() {
    return this.root.valuetype;
  }

  get idtype() {
    return this.root.idtype;
  }

  get idtypes() {
    return [this.idtype];
  }

  /*get indices() {
   return this.range;
   }*/

  sort(compareFn?: (a: T, b: T) => number, thisArg?: any): Promise<IVector<T,D>> {
    return this.data().then((d) => {
      const indices = argSort(d, compareFn, thisArg);
      return this.view(this.range.preMultiply(rlist(indices)));
    });
  }

  filter(callbackfn: (value: T, index: number) => boolean, thisArg?: any): Promise<IVector<T,D>> {
    return this.data().then((d) => {
      const indices = argFilter(d, callbackfn, thisArg);
      return this.view(this.range.preMultiply(rlist(indices)));
    });
  }
}

