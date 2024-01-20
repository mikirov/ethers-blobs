import { ethers } from "ethers";
import { assert } from "chai";
import * as dotenv from "dotenv";

import pkg from 'c-kzg';
import * as path from 'path';

const {
    blobToKzgCommitment,
    computeBlobKzgProof,
    verifyBlobKzgProof,
    loadTrustedSetup
  } = pkg;
  
dotenv.config();

assert(process.env.OWNER_PK !== undefined);
assert(process.env.RPC_URL !== undefined);

const ownerPrivateKey: string = process.env.OWNER_PK;
const rpcUrl: string = process.env.RPC_URL;

// Setup provider, wallet
const provider: ethers.providers.JsonRpcProvider = new ethers.providers.JsonRpcProvider(rpcUrl);
const signer: ethers.Wallet = new ethers.Wallet(ownerPrivateKey, provider);

async function sendRawTransaction() {
    const from: string = await signer.getAddress();
    const to: string = await ethers.Wallet.createRandom().getAddress();
    const nonce: number = await provider.getTransactionCount(from);
    const chainId: number = await signer.getChainId();
    const feeData: ethers.providers.FeeData = await provider.getFeeData();

    // console.log(feeData);

    // blob generation
    const BYTES_PER_BLOB = 4096 * 32
    let dummyBlob = Buffer.alloc(BYTES_PER_BLOB, "*")

    loadTrustedSetup(path.resolve("src/trusted_setup.txt"))
    const commitment = blobToKzgCommitment(dummyBlob);
    const proof = computeBlobKzgProof(dummyBlob, commitment);

    const isValid = verifyBlobKzgProof(dummyBlob, commitment, proof)
    console.log(isValid)
    console.log(ethers.utils.sha256(commitment))
    console.log( "0x01" + ethers.utils.sha256(commitment).substr(4, 64)) // versioned hash
    const txPayloadBody = {
        chainId: ethers.utils.hexlify(chainId),
        nonce: ethers.utils.hexlify(nonce),
        maxPriorityFeePerGas: ethers.utils.hexlify(feeData.maxPriorityFeePerGas),
        maxFeePerGas: ethers.utils.hexlify(feeData.maxFeePerGas),
        gasLimit: ethers.utils.hexlify(250000),
        // gasPrice: ethers.utils.hexlify(feeData.gasPrice),
        to,
        value: "0x00",
        data: "0x00",
        accessList: "0x00",
        maxFeePerBlobGas: ethers.utils.hexlify(10000000),
        blobVersionedHashes: "0x00" + ethers.utils.sha256(commitment).substr(2, 64)
    };

    console.log(txPayloadBody);

    let encodedPayload: Array<string> = [];
    Object.values(txPayloadBody).forEach((value: any) => encodedPayload.push(ethers.utils.RLP.encode(ethers.utils.arrayify(value))));

    // BLOB_TX_TYPE concatenated with encoded payload
    const BLOB_TX_TYPE = '0x03'; // source https://github.com/ethereum/EIPs/blob/master/EIPS/eip-4844.md
    
    // encodedPayload = ethers.utils.arrayify(BLOB_TX_TYPE).concat(encodedPayload);
    // console.log(encodedPayload)
    const payloadForHashing = ethers.utils.concat([BLOB_TX_TYPE, ...encodedPayload]);
    console.log(payloadForHashing)

    // Calculate the digest
    const digest = ethers.utils.keccak256(payloadForHashing);
    const signature = await signer.signMessage(ethers.utils.arrayify(digest));
    const { r, s, v } = ethers.utils.splitSignature(signature);

    let signedTransaction = {
        ...txPayloadBody,
        v,
        r: ethers.utils.hexZeroPad(r, 32),
        s: ethers.utils.hexZeroPad(s, 32),
    }
    console.log(signedTransaction)

    // console.log(ethers.utils.hexlify(signedTransaction))
    let arr: any[] = [];
    Object.values(signedTransaction).forEach(v => { arr = ethers.utils.concat([...arr, ...ethers.utils.arrayify(v)]) as any});
    let hexlifiedSignedTransaction = ethers.utils.hexlify(arr)
    console.log(hexlifiedSignedTransaction);
    const txHash = await provider.send('eth_sendRawTransaction', [hexlifiedSignedTransaction]);
    console.log(txHash)
}

sendRawTransaction()
    .then(txHash => console.log('Transaction Hash:', txHash))
    .catch(error => console.error(error));