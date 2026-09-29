import brandIcon from '../../../public/icon/asterveil.svg?raw';
import { productName } from '../../shared/edition';
import { mountSubmitter } from '../../submitter/popup';
import '../../submitter/popup.css';

const logo = document.querySelector('.logo');
document.title = productName;
if (logo) logo.innerHTML = brandIcon;

mountSubmitter();
