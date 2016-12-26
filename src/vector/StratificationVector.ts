/* *****************************************************************************
 * Caleydo - Visualization for Molecular Biology - http://caleydo.org
 * Copyright (c) The Caleydo Team. All rights reserved.
 * Licensed under the new BSD license, available at http://caleydo.org/license
 **************************************************************************** */
/**
 * Created by Samuel Gratzl on 04.08.2014.
 */

import {all, Range, RangeLike, CompositeRange1D} from '../range';
import {IDataType, ADataType,} from '../datatype';
import {IHistogram, rangeHist} from '../math';
import {IVector} from './IVector';
import {IStratification, IGroup, IStratificationDataDescription} from '../stratification';
import StratificationGroup from '../stratification/StratificationGroup';

/**
 * root matrix implementation holding the data
 */
export default class StratificationVector extends ADataType<IStratificationDataDescription> implements IStratification {

  constructor(private v: IVector, private r: CompositeRange1D) {
    super({
      id: v.desc.id + '-s',
      name: v.desc.name,
      description: v.desc.description,
      creator: v.desc.creator,
      ts: v.desc.ts,
      fqname: v.desc.fqname,
      type: 'stratification',
      idtype: v.idtype,
      size: v.length,
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

  hist(bins?: number, range: RangeLike = all()): Promise<IHistogram> {
    // FIXME unused parameter
    return this.range().then((r) => {
      return rangeHist(r);
    });
  }

  vector() {
    return this.asVector();
  }

  asVector() {
    return Promise.resolve(this.v);
  }

  origin(): Promise<IDataType> {
    return this.asVector();
  }

  range() {
    return Promise.resolve(this.r);
  }

  idRange() {
    return this.ids().then((ids) => {
      return ids.dim(0).preMultiply(this.r, this.dim[0]);
    });
  }

  names(range: RangeLike = all()) {
    return this.v.names(range);
  }

  ids(range: RangeLike = all()): Promise<Range> {
    return this.v.ids(range);
  }

  get idtypes() {
    return [this.idtype];
  }

  size() {
    return this.desc.size;
  }

  get length() {
    return this.size();
  }

  get ngroups() {
    return this.ngroups;
  }

  get dim() {
    return [this.size()];
  }

  persist() {
    return {
      root: this.v.persist(),
      asstrat: true
    };
  }
}
